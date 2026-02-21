/**
 * Validate Tool — Health check agents via Tailscale SSH
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { loadManifest, resolveConfigName } from "../lib/config";
import { SSH_USER, tailscaleHostname } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { requireTailscale } from "../lib/tailscale";
import { getConfig } from "../lib/tool-helpers";
import pc from "picocolors";

export interface ValidateOptions {
  /** SSH timeout in seconds */
  timeout?: string;
  /** Config name (auto-detected if only one) */
  config?: string;
}

interface CheckResult {
  agent: string;
  checks: { name: string; passed: boolean; detail?: string }[];
  passed: boolean;
}

/**
 * SSH options for non-interactive connections
 */
const SSH_OPTS = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "BatchMode=yes",
];

/**
 * Run an SSH check command
 */
function runSshCheck(
  exec: ExecAdapter,
  host: string,
  command: string,
  timeout: number
): { ok: boolean; output: string } {
  const result = exec.capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    ...SSH_OPTS,
    `${SSH_USER}@${host}`,
    `"${command.replace(/"/g, '\\"')}"`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Validate tool implementation
 */
export const validateTool: ToolImplementation<ValidateOptions> = async (
  runtime: RuntimeAdapter,
  options: ValidateOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Agent Army");

  requireTailscale();

  // Ensure workspace is set up (no-op in dev mode)
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    ui.log.error(wsResult.error ?? "Failed to set up workspace.");
    process.exit(1);
  }
  const cwd = getWorkspaceDir();

  // Resolve config name and load manifest
  let configName: string;
  try {
    configName = resolveConfigName(options.config);
  } catch (err) {
    ui.log.error((err as Error).message);
    process.exit(1);
  }

  const manifest = loadManifest(configName);
  if (!manifest) {
    ui.log.error(`Config '${configName}' could not be loaded.`);
    process.exit(1);
  }

  // Select/create stack
  const selectResult = exec.capture("pulumi", ["stack", "select", manifest.stackName], cwd);
  if (selectResult.exitCode !== 0) {
    const initResult = exec.capture("pulumi", ["stack", "init", manifest.stackName], cwd);
    if (initResult.exitCode !== 0) {
      ui.log.error(`Could not select Pulumi stack "${manifest.stackName}".`);
      process.exit(1);
    }
  }

  // Get tailnet
  const tailnetDnsName = getConfig(exec, "tailnetDnsName", cwd);
  if (!tailnetDnsName) {
    ui.log.error("Could not determine tailnet DNS name from Pulumi config.");
    process.exit(1);
  }

  const timeout = parseInt(options.timeout ?? "30", 10);
  const results: CheckResult[] = [];

  ui.log.step(`Validating ${manifest.agents.length} agents (timeout: ${timeout}s)...`);
  console.log();

  for (const agent of manifest.agents) {
    const tsHost = tailscaleHostname(manifest.stackName, agent.name);
    const host = `${tsHost}.${tailnetDnsName}`;
    const checks: CheckResult["checks"] = [];

    ui.log.info(`${pc.bold(agent.displayName)} (${agent.role}) — ${host}`);

    // Check 1: SSH connectivity
    const ssh = runSshCheck(exec, host, "echo 'SSH OK'", timeout);
    checks.push({
      name: "SSH connectivity",
      passed: ssh.ok,
      detail: ssh.ok ? "connected" : "connection failed",
    });

    if (ssh.ok) {
      // Check 2: OpenClaw gateway running (systemd user service)
      const gateway = runSshCheck(exec, host, "systemctl --user is-active openclaw-gateway", timeout);
      checks.push({
        name: "OpenClaw gateway",
        passed: gateway.ok,
        detail: gateway.ok ? "running" : gateway.output || "not running",
      });

      // Check 3: Workspace files present
      const workspace = runSshCheck(
        exec,
        host,
        `test -f /home/${SSH_USER}/.openclaw/workspace/SOUL.md && test -f /home/${SSH_USER}/.openclaw/workspace/HEARTBEAT.md && echo 'OK'`,
        timeout
      );
      checks.push({
        name: "Workspace files",
        passed: workspace.ok,
        detail: workspace.ok ? "SOUL.md + HEARTBEAT.md present" : "missing files",
      });

      // Check 4: Claude Code CLI installed
      const claudeCode = runSshCheck(
        exec,
        host,
        `/home/${SSH_USER}/.local/bin/claude --version 2>/dev/null || echo 'not installed'`,
        timeout
      );
      const claudeVersion = claudeCode.output.trim();
      const claudeInstalled = claudeCode.ok && !claudeVersion.includes("not installed");
      checks.push({
        name: "Claude Code CLI",
        passed: claudeInstalled,
        detail: claudeInstalled ? claudeVersion : "not installed",
      });

      // Check 5: Claude Code auth (API key or OAuth token)
      if (claudeInstalled) {
        const credCheck = runSshCheck(
          exec,
          host,
          `grep -E '"(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)"' /home/${SSH_USER}/.openclaw/openclaw.json | head -1`,
          timeout
        );
        const hasApiKey = credCheck.output.includes("ANTHROPIC_API_KEY");
        const hasOAuthToken = credCheck.output.includes("CLAUDE_CODE_OAUTH_TOKEN");
        const credIsConfigured = credCheck.ok && (hasApiKey || hasOAuthToken);
        const credType = hasOAuthToken ? "OAuth token" : "API key";

        if (credIsConfigured) {
          const envVar = hasOAuthToken ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY";
          const testScript = `
export ${envVar}=$(jq -r '.env.${envVar}' /home/${SSH_USER}/.openclaw/openclaw.json)
timeout 15 /home/${SSH_USER}/.local/bin/claude -p 'hi' 2>&1 | head -5
          `.trim();
          const authTest = runSshCheck(exec, host, testScript, timeout + 15);
          const authWorks = authTest.ok && 
            !authTest.output.includes("Invalid API key") && 
            !authTest.output.includes("not authenticated");
          checks.push({
            name: "Claude Code auth",
            passed: authWorks,
            detail: authWorks ? `${credType} verified` : `${credType} test failed: ${authTest.output.substring(0, 50)}`,
          });
        } else {
          checks.push({
            name: "Claude Code auth",
            passed: false,
            detail: "No credentials configured",
          });
        }
      }

      // Check 6: GitHub CLI installed
      const ghVersion = runSshCheck(
        exec,
        host,
        `gh --version 2>/dev/null | head -n1 || echo 'not installed'`,
        timeout
      );
      const ghVersionStr = ghVersion.output.trim();
      const ghInstalled = ghVersion.ok && !ghVersionStr.includes("not installed");
      checks.push({
        name: "GitHub CLI",
        passed: ghInstalled,
        detail: ghInstalled ? ghVersionStr : "not installed",
      });

      // Check 7: GitHub CLI auth status (if installed)
      if (ghInstalled) {
        const ghAuth = runSshCheck(
          exec,
          host,
          `gh auth status 2>&1 | head -n2 || echo 'not authenticated'`,
          timeout
        );
        const ghAuthStr = ghAuth.output.trim();
        const ghAuthenticated = ghAuth.ok && 
          !ghAuthStr.includes("not authenticated") && 
          !ghAuthStr.includes("not logged");
        checks.push({
          name: "GitHub CLI auth",
          passed: ghAuthenticated,
          detail: ghAuthenticated ? "authenticated" : "not authenticated (optional)",
        });
      }
    } else {
      checks.push({ name: "OpenClaw gateway", passed: false, detail: "skipped (no SSH)" });
      checks.push({ name: "Workspace files", passed: false, detail: "skipped (no SSH)" });
      checks.push({ name: "Claude Code CLI", passed: false, detail: "skipped (no SSH)" });
      checks.push({ name: "Claude Code auth", passed: false, detail: "skipped (no SSH)" });
      checks.push({ name: "GitHub CLI", passed: false, detail: "skipped (no SSH)" });
      checks.push({ name: "GitHub CLI auth", passed: false, detail: "skipped (no SSH)" });
    }

    // Display check results
    const allPassed = checks.every((c) => c.passed);
    for (const check of checks) {
      const icon = check.passed ? pc.green("PASS") : pc.red("FAIL");
      console.log(`    ${icon}  ${check.name}: ${check.detail ?? ""}`);
    }
    console.log();

    results.push({ agent: agent.displayName, checks, passed: allPassed });
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  const summaryLines = [
    `Total:  ${results.length}`,
    `Passed: ${passed}`,
    `Failed: ${failed}`,
  ];

  ui.note(summaryLines.join("\n"), "Validation Summary");

  if (failed > 0) {
    ui.log.warn("Some agents failed validation.");
    console.log("  1. Wait 3-5 minutes for cloud-init to complete");
    const agentHints = results
      .filter((r) => !r.passed)
      .map((r) => {
        const agent = manifest.agents.find((a) => a.displayName === r.agent);
        return agent ? agent.role : r.agent;
      });
    console.log(`  2. Check logs: clawup ssh ${agentHints[0] ?? "<role>"} -- journalctl -u openclaw`);
    console.log("  3. Verify Tailscale: tailscale status");
    process.exit(1);
  } else {
    ui.log.success("All agents are healthy!");
  }
};
