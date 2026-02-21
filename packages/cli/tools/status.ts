/**
 * Status Tool — Show agent statuses from stack outputs
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { loadManifest, resolveConfigName } from "../lib/config";
import { SSH_USER, tailscaleHostname } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { isTailscaleRunning } from "../lib/tailscale";
import { getConfig, getStackOutputs } from "../lib/tool-helpers";

export interface StatusOptions {
  /** Output as JSON */
  json?: boolean;
  /** Config name (auto-detected if only one) */
  config?: string;
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
 * Fetch Claude Code version via SSH (best effort, returns "—" on failure)
 */
function getClaudeCodeVersion(exec: ExecAdapter, host: string, timeout: number = 5): string {
  const result = exec.capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    ...SSH_OPTS,
    `${SSH_USER}@${host}`,
    `"/home/${SSH_USER}/.local/bin/claude --version 2>/dev/null || echo ''"`,
  ]);
  if (result.exitCode === 0 && result.stdout?.trim()) {
    return result.stdout.trim();
  }
  return "—";
}

/**
 * Fetch GitHub CLI version via SSH (best effort, returns "—" on failure)
 */
function getGhVersion(exec: ExecAdapter, host: string, timeout: number = 5): string {
  const result = exec.capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    ...SSH_OPTS,
    `${SSH_USER}@${host}`,
    `"gh --version 2>/dev/null | head -n1 | awk '{print \\$3}' || echo ''"`,
  ]);
  if (result.exitCode === 0 && result.stdout?.trim()) {
    return result.stdout.trim();
  }
  return "—";
}

/**
 * Fetch GitHub CLI auth status via SSH (best effort, returns "✓" or "—")
 */
function getGhAuthStatus(exec: ExecAdapter, host: string, timeout: number = 5): string {
  const result = exec.capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    ...SSH_OPTS,
    `${SSH_USER}@${host}`,
    `"gh auth status 2>&1 >/dev/null && echo 'OK' || echo 'no'"`,
  ]);
  if (result.exitCode === 0 && result.stdout?.trim() === "OK") {
    return "✓";
  }
  return "—";
}

/**
 * Status tool implementation
 */
export const statusTool: ToolImplementation<StatusOptions> = async (
  runtime: RuntimeAdapter,
  options: StatusOptions
) => {
  const { ui, exec } = runtime;

  if (!options.json) {
    ui.intro("Agent Army");
  }

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
      if (!options.json) {
        ui.log.error(initResult.stderr || selectResult.stderr);
        ui.log.error(`Could not select Pulumi stack "${manifest.stackName}".`);
      }
      process.exit(1);
    }
  }

  // Get outputs
  const outputs = getStackOutputs(exec, true, cwd);
  if (!outputs) {
    ui.log.error("Could not fetch stack outputs. Has the stack been deployed?");
    process.exit(1);
  }

  // Get tailnet DNS name for SSH connections
  const tailnetDnsName = getConfig(exec, "tailnetDnsName", cwd);

  // Warn if Tailscale is not running (SSH version columns will show "—")
  const tailscaleUp = isTailscaleRunning();
  if (!tailscaleUp && !options.json) {
    ui.log.warn(
      "Tailscale is not running — CLI version columns will show \"—\".\n" +
      "  Open the Tailscale app or run: tailscale up"
    );
  }

  // Build status data with Claude Code and GitHub CLI versions (fetched via SSH)
  const statusData = manifest.agents.map((agent) => {
    let claudeCodeVersion = "—";
    let ghVersion = "—";
    let ghAuth = "—";
    if (tailnetDnsName) {
      const tsHost = tailscaleHostname(manifest.stackName, agent.name);
      const host = `${tsHost}.${tailnetDnsName}`;
      claudeCodeVersion = getClaudeCodeVersion(exec, host);
      ghVersion = getGhVersion(exec, host);
      if (ghVersion !== "—") {
        ghAuth = getGhAuthStatus(exec, host);
      }
    }
    return {
      name: agent.displayName,
      role: agent.role,
      instanceId: (outputs[`${agent.role}InstanceId`] as string) ?? "—",
      publicIp: (outputs[`${agent.role}PublicIp`] as string) ?? "—",
      tailscaleUrl: (outputs[`${agent.role}TailscaleUrl`] as string) ?? "—",
      claudeCodeVersion,
      ghVersion,
      ghAuth,
    };
  });

  // JSON output
  if (options.json) {
    console.log(JSON.stringify(statusData, null, 2));
    return;
  }

  // Table output
  ui.log.step(`Stack: ${manifest.stackName} | Region: ${manifest.region}`);
  console.log();

  // Header
  const nameW = 12;
  const roleW = 10;
  const idW = 22;
  const ipW = 16;
  const claudeW = 16;
  const ghW = 8;
  const authW = 6;

  const header = [
    "Agent".padEnd(nameW),
    "Role".padEnd(roleW),
    "Instance ID".padEnd(idW),
    "Public IP".padEnd(ipW),
    "Claude Code".padEnd(claudeW),
    "gh".padEnd(ghW),
    "Auth".padEnd(authW),
  ].join("  ");

  const separator = [
    "─".repeat(nameW),
    "─".repeat(roleW),
    "─".repeat(idW),
    "─".repeat(ipW),
    "─".repeat(claudeW),
    "─".repeat(ghW),
    "─".repeat(authW),
  ].join("  ");

  console.log(`  ${header}`);
  console.log(`  ${separator}`);

  for (const s of statusData) {
    const row = [
      s.name.padEnd(nameW),
      s.role.padEnd(roleW),
      s.instanceId.padEnd(idW),
      s.publicIp.padEnd(ipW),
      s.claudeCodeVersion.padEnd(claudeW),
      s.ghVersion.padEnd(ghW),
      s.ghAuth.padEnd(authW),
    ].join("  ");
    console.log(`  ${row}`);
  }

  console.log();

  // Show Tailscale URLs
  const urlLines = statusData
    .filter((s) => s.tailscaleUrl !== "—")
    .map((s) => `  ${s.name}: ${s.tailscaleUrl}`);

  if (urlLines.length > 0) {
    ui.note(urlLines.join("\n"), "Tailscale URLs");
  }
};
