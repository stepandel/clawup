/**
 * Validate Tool — Health check agents via Tailscale SSH
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import path from "path";
import os from "os";
import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { requireManifest } from "../lib/config";
import { SSH_USER, tailscaleHostname, dockerContainerName, CODING_AGENT_REGISTRY, DEP_REGISTRY, resolvePlugin } from "@clawup/core";
import type { IdentityManifest, IdentityResult } from "@clawup/core";
import { fetchIdentitySync } from "@clawup/core/identity";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { requireTailscale } from "../lib/tailscale";
import { getConfig } from "../lib/tool-helpers";
import { qualifiedStackName } from "../lib/pulumi";
import pc from "picocolors";

export interface ValidateOptions {
  /** SSH timeout in seconds */
  timeout?: string;
  /** Validate local Docker containers */
  local?: boolean;
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
 * Run a Docker exec check command
 */
function runDockerCheck(
  exec: ExecAdapter,
  containerName: string,
  command: string,
): { ok: boolean; output: string } {
  // Run as ubuntu user (-u) to match SSH behavior (gh auth, NVM, etc.)
  // Wrap command in double quotes so execSync (which joins args with spaces)
  // passes it as a single argument to bash -c
  const escaped = command.replace(/"/g, '\\"');
  const result = exec.capture("docker", [
    "exec", "-u", SSH_USER, containerName, "bash", "-c", `"${escaped}"`,
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

  ui.intro("Clawup");

  // Ensure workspace is set up (no-op in dev mode)
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    ui.log.error(wsResult.error ?? "Failed to set up workspace.");
    process.exit(1);
  }
  const cwd = getWorkspaceDir();

  // Load manifest
  let manifest;
  try {
    manifest = requireManifest();
  } catch (err) {
    ui.log.error((err as Error).message);
    process.exit(1);
  }

  // --local: override provider in memory, use separate stack
  if (options.local) {
    manifest = { ...manifest, provider: "local" as const };
  }

  // Select/create stack (use org-qualified name if organization is set)
  const stackName = options.local ? `${manifest.stackName}-local` : manifest.stackName;
  const pulumiStack = qualifiedStackName(stackName, manifest.organization);
  const selectResult = exec.capture("pulumi", ["stack", "select", pulumiStack], cwd);
  if (selectResult.exitCode !== 0) {
    const initResult = exec.capture("pulumi", ["stack", "init", pulumiStack], cwd);
    if (initResult.exitCode !== 0) {
      ui.log.error(`Could not select Pulumi stack "${pulumiStack}".`);
      process.exit(1);
    }
  }

  const isLocal = manifest.provider === "local";

  // Get tailnet (not needed for local Docker)
  let tailnetDnsName: string | undefined;
  if (!isLocal) {
    requireTailscale();
    tailnetDnsName = getConfig(exec, "tailnetDnsName", cwd) ?? undefined;
    if (!tailnetDnsName) {
      ui.log.error("Could not determine tailnet DNS name from Pulumi config.");
      process.exit(1);
    }
  }

  // Load identity manifests for each agent
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const identityMap: Record<string, IdentityManifest> = {};
  const identityResultMap: Record<string, IdentityResult> = {};
  for (const agent of manifest.agents) {
    try {
      const identity = fetchIdentitySync(agent.identity, identityCacheDir);
      identityMap[agent.name] = identity.manifest;
      identityResultMap[agent.name] = identity;
    } catch (err) {
      ui.log.warn(`Could not load identity for ${agent.displayName}: ${(err as Error).message}`);
    }
  }

  const timeout = parseInt(options.timeout ?? "30", 10);
  const results: CheckResult[] = [];

  ui.log.step(`Validating ${manifest.agents.length} agents (timeout: ${timeout}s)...`);
  console.log();

  for (const agent of manifest.agents) {
    const containerName = isLocal ? dockerContainerName(stackName, agent.name) : "";
    const tsHost = isLocal ? "" : tailscaleHostname(manifest.stackName, agent.name);
    const host = isLocal ? containerName : `${tsHost}.${tailnetDnsName}`;

    // Helper that dispatches to Docker or SSH
    const runCheck = (command: string) =>
      isLocal ? runDockerCheck(exec, containerName, command) : runSshCheck(exec, host, command, timeout);

    const checks: CheckResult["checks"] = [];
    const identityManifest = identityMap[agent.name];
    const displayHost = isLocal ? containerName : host;

    ui.log.info(`${pc.bold(agent.displayName)} (${agent.role}) — ${displayHost}`);

    // Check 1: Connectivity (SSH for cloud, container running for local)
    let connected: boolean;
    if (isLocal) {
      const inspect = exec.capture("docker", ["inspect", "-f", "{{.State.Running}}", containerName]);
      connected = inspect.exitCode === 0 && inspect.stdout?.trim() === "true";
      checks.push({
        name: "Container running",
        passed: connected,
        detail: connected ? "running" : "not running",
      });
    } else {
      const ssh = runSshCheck(exec, host, "echo 'SSH OK'", timeout);
      connected = ssh.ok;
      checks.push({
        name: "SSH connectivity",
        passed: ssh.ok,
        detail: ssh.ok ? "connected" : "connection failed",
      });
    }

    if (connected) {
      // Check 2: OpenClaw gateway running
      const gatewayCmd = isLocal
        ? "pgrep -f 'openclaw' > /dev/null && echo active || echo inactive"
        : "systemctl --user is-active openclaw-gateway";
      const gateway = runCheck(gatewayCmd);
      const gatewayRunning = gateway.ok && (isLocal ? gateway.output.trim().includes("active") : true);
      checks.push({
        name: "OpenClaw gateway",
        passed: gatewayRunning,
        detail: gatewayRunning ? "running" : gateway.output || "not running",
      });

      // Check 3: Workspace files present
      const workspace = runCheck(
        `test -f /home/${SSH_USER}/.openclaw/workspace/SOUL.md && test -f /home/${SSH_USER}/.openclaw/workspace/HEARTBEAT.md && echo 'OK'`
      );
      checks.push({
        name: "Workspace files",
        passed: workspace.ok,
        detail: workspace.ok ? "SOUL.md + HEARTBEAT.md present" : "missing files",
      });

      // Dynamic checks based on identity manifest
      if (identityManifest) {
        // Coding agent checks
        if (identityManifest.codingAgent) {
          const agentEntry = CODING_AGENT_REGISTRY[identityManifest.codingAgent];
          if (!agentEntry) {
            ui.log.warn(`Unknown coding agent "${identityManifest.codingAgent}" — skipping checks`);
          } else {
            const cmd = agentEntry.cliBackend.command;

            // Version check
            const versionCheck = runCheck(
              `/home/${SSH_USER}/.local/bin/${cmd} --version 2>/dev/null || ${cmd} --version 2>/dev/null || echo 'not installed'`
            );
            const version = versionCheck.output.trim();
            const installed = versionCheck.ok && !version.includes("not installed");
            checks.push({
              name: `${agentEntry.displayName} CLI`,
              passed: installed,
              detail: installed ? version : "not installed",
            });

            // Auth check — dynamic, driven by registry secrets
            if (installed && Object.keys(agentEntry.secrets).length > 0) {
              const secretEnvVars = Object.values(agentEntry.secrets).map((s) => s.envVar);
              const grepPattern = secretEnvVars.map((v) => `"${v}"`).join("|");
              const credCheck = runCheck(
                `grep -E '(${grepPattern})' /home/${SSH_USER}/.openclaw/openclaw.json | head -1`
              );

              // Find first configured secret (OR logic — any one is sufficient)
              const foundEnvVar = secretEnvVars.find((v) => credCheck.output.includes(v));
              const credIsConfigured = credCheck.ok && !!foundEnvVar;

              if (credIsConfigured) {
                const testScript = `
export ${foundEnvVar}=$(jq -r '.env.${foundEnvVar}' /home/${SSH_USER}/.openclaw/openclaw.json)
timeout 15 /home/${SSH_USER}/.local/bin/${cmd} -p 'hi' 2>&1 | head -5
                `.trim();
                const authTest = runCheck(testScript);
                const authWorks = authTest.ok &&
                  !authTest.output.includes("Invalid API key") &&
                  !authTest.output.includes("not authenticated");
                checks.push({
                  name: `${agentEntry.displayName} auth`,
                  passed: authWorks,
                  detail: authWorks ? `${foundEnvVar} verified` : `${foundEnvVar} authentication test failed`,
                });
              } else {
                checks.push({
                  name: `${agentEntry.displayName} auth`,
                  passed: false,
                  detail: "No credentials configured",
                });
              }
            }
          }
        }

        // Dep checks
        for (const dep of identityManifest.deps ?? []) {
          const depEntry = DEP_REGISTRY[dep];
          if (!depEntry) {
            ui.log.warn(`Unknown dep "${dep}" — skipping checks`);
            continue;
          }

          // Binary check (only if installScript is non-empty)
          if (depEntry.installScript) {
            const depVersion = runCheck(
              `${dep} --version 2>/dev/null | head -n1 || echo 'not installed'`
            );
            const depVersionStr = depVersion.output.trim();
            const depInstalled = depVersion.ok && !depVersionStr.includes("not installed");
            checks.push({
              name: depEntry.displayName,
              passed: depInstalled,
              detail: depInstalled ? depVersionStr : "not installed",
            });
          }

          // Secret checks
          for (const secret of Object.values(depEntry.secrets)) {
            const secretCheck = runCheck(secret.checkCommand);
            checks.push({
              name: `${depEntry.displayName} auth`,
              passed: secretCheck.ok,
              detail: secretCheck.ok ? "configured" : `${secret.envVar} not configured`,
            });
          }
        }

        // Plugin secret checks
        for (const plugin of identityManifest.plugins ?? []) {
          const pluginManifest = resolvePlugin(plugin, identityResultMap[agent.name]);
          if (Object.keys(pluginManifest.secrets).length === 0) continue;

          for (const [key, secret] of Object.entries(pluginManifest.secrets)) {
            // Use configPath to determine where secrets live in openclaw.json
            const pyPath = pluginManifest.configPath === "channels"
              ? `c.get('channels',{}).get('${plugin}',{}).get('${key}')`
              : `c.get('plugins',{}).get('entries',{}).get('${plugin}',{}).get('config',{}).get('${key}')`;
            const secretCheck = runCheck(
              `python3 -c "import json,sys;c=json.load(open('/home/${SSH_USER}/.openclaw/openclaw.json'));sys.exit(0 if ${pyPath} else 1)"`
            );
            checks.push({
              name: `${plugin} secret (${secret.envVar})`,
              passed: secretCheck.ok,
              detail: secretCheck.ok ? "configured" : `${secret.envVar} not configured`,
            });
          }
        }
      } else {
        // Fallback: no identity manifest — keep hardcoded checks
        const claudeCode = runCheck(
          `/home/${SSH_USER}/.local/bin/claude --version 2>/dev/null || echo 'not installed'`
        );
        const claudeVersion = claudeCode.output.trim();
        const claudeInstalled = claudeCode.ok && !claudeVersion.includes("not installed");
        checks.push({
          name: "Claude Code CLI",
          passed: claudeInstalled,
          detail: claudeInstalled ? claudeVersion : "not installed",
        });

        if (claudeInstalled) {
          const credCheck = runCheck(
            `grep -E '"(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)"' /home/${SSH_USER}/.openclaw/openclaw.json | head -1`
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
            const authTest = runCheck(testScript);
            const authWorks = authTest.ok &&
              !authTest.output.includes("Invalid API key") &&
              !authTest.output.includes("not authenticated");
            checks.push({
              name: "Claude Code auth",
              passed: authWorks,
              detail: authWorks ? `${credType} verified` : `${credType} authentication test failed`,
            });
          } else {
            checks.push({
              name: "Claude Code auth",
              passed: false,
              detail: "No credentials configured",
            });
          }
        }

        const ghVersion = runCheck(
          `gh --version 2>/dev/null | head -n1 || echo 'not installed'`
        );
        const ghVersionStr = ghVersion.output.trim();
        const ghInstalled = ghVersion.ok && !ghVersionStr.includes("not installed");
        checks.push({
          name: "GitHub CLI",
          passed: ghInstalled,
          detail: ghInstalled ? ghVersionStr : "not installed",
        });

        if (ghInstalled) {
          const ghAuth = runCheck(
            `gh auth status 2>&1 | head -n2 || echo 'not authenticated'`
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
      }
    } else {
      // Connection failed — generate skip entries dynamically
      const skipReason = isLocal ? "skipped (container not running)" : "skipped (no SSH)";
      checks.push({ name: "OpenClaw gateway", passed: false, detail: skipReason });
      checks.push({ name: "Workspace files", passed: false, detail: skipReason });

      if (identityManifest) {
        if (identityManifest.codingAgent) {
          const agentEntry = CODING_AGENT_REGISTRY[identityManifest.codingAgent];
          if (agentEntry) {
            checks.push({ name: `${agentEntry.displayName} CLI`, passed: false, detail: skipReason });
            checks.push({ name: `${agentEntry.displayName} auth`, passed: false, detail: skipReason });
          }
        }
        for (const dep of identityManifest.deps ?? []) {
          const depEntry = DEP_REGISTRY[dep];
          if (depEntry) {
            if (depEntry.installScript) {
              checks.push({ name: depEntry.displayName, passed: false, detail: skipReason });
            }
            for (const _secret of Object.values(depEntry.secrets)) {
              checks.push({ name: `${depEntry.displayName} auth`, passed: false, detail: skipReason });
            }
          }
        }
        for (const plugin of identityManifest.plugins ?? []) {
          const pluginManifest = resolvePlugin(plugin, identityResultMap[agent.name]);
          for (const [_key, secret] of Object.entries(pluginManifest.secrets)) {
            checks.push({ name: `${plugin} secret (${secret.envVar})`, passed: false, detail: skipReason });
          }
        }
      } else {
        checks.push({ name: "Claude Code CLI", passed: false, detail: skipReason });
        checks.push({ name: "Claude Code auth", passed: false, detail: skipReason });
        checks.push({ name: "GitHub CLI", passed: false, detail: skipReason });
        checks.push({ name: "GitHub CLI auth", passed: false, detail: skipReason });
      }
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
    const agentHints = results
      .filter((r) => !r.passed)
      .map((r) => {
        const agent = manifest.agents.find((a) => a.displayName === r.agent);
        return agent ? agent.role : r.agent;
      });
    if (isLocal) {
      console.log("  1. Check container logs: docker logs " + dockerContainerName(stackName, manifest.agents[0]?.name ?? "agent"));
      console.log(`  2. Shell in: clawup ssh ${agentHints[0] ?? "<role>"} --local`);
    } else {
      console.log("  1. Wait 3-5 minutes for cloud-init to complete");
      console.log(`  2. Check logs: clawup ssh ${agentHints[0] ?? "<role>"} -- journalctl -u openclaw`);
      console.log("  3. Verify Tailscale: tailscale status");
    }
    process.exit(1);
  } else {
    ui.log.success("All agents are healthy!");
  }
};
