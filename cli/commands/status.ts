/**
 * agent-army status — Show agent statuses from stack outputs
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { getConfig, getStackOutputs, selectOrCreateStack } from "../lib/pulumi";
import { capture } from "../lib/exec";
import { SSH_USER, tailscaleHostname } from "../lib/constants";
import { showBanner, exitWithError } from "../lib/ui";

interface StatusOptions {
  json?: boolean;
}

/**
 * Fetch Claude Code version via SSH (best effort, returns "—" on failure)
 */
function getClaudeCodeVersion(host: string, timeout: number = 5): string {
  const result = capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "BatchMode=yes",
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
function getGhVersion(host: string, timeout: number = 5): string {
  const result = capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "BatchMode=yes",
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
function getGhAuthStatus(host: string, timeout: number = 5): string {
  const result = capture("ssh", [
    "-o", `ConnectTimeout=${timeout}`,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "BatchMode=yes",
    `${SSH_USER}@${host}`,
    `"gh auth status 2>&1 >/dev/null && echo 'OK' || echo 'no'"`,
  ]);
  if (result.exitCode === 0 && result.stdout?.trim() === "OK") {
    return "✓";
  }
  return "—";
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  if (!opts.json) showBanner();

  // Load manifest
  const manifest = loadManifest();
  if (!manifest) {
    exitWithError("No agent-army.json found. Run `agent-army init` first.");
  }

  // Select stack
  const stackResult = selectOrCreateStack(manifest.stackName);
  if (!stackResult.ok) {
    if (stackResult.error) p.log.error(stackResult.error);
    exitWithError(`Could not select Pulumi stack "${manifest.stackName}".`);
  }

  // Get outputs
  const outputs = getStackOutputs(true);
  if (!outputs) {
    exitWithError("Could not fetch stack outputs. Has the stack been deployed?");
  }

  // Get tailnet DNS name for SSH connections
  const tailnetDnsName = getConfig("tailnetDnsName");

  // Build status data with Claude Code and GitHub CLI versions (fetched via SSH)
  const statusData = manifest.agents.map((agent) => {
    let claudeCodeVersion = "—";
    let ghVersion = "—";
    let ghAuth = "—";
    if (tailnetDnsName) {
      const tsHost = tailscaleHostname(manifest.stackName, agent.name);
      const host = `${tsHost}.${tailnetDnsName}`;
      claudeCodeVersion = getClaudeCodeVersion(host);
      ghVersion = getGhVersion(host);
      if (ghVersion !== "—") {
        ghAuth = getGhAuthStatus(host);
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
  if (opts.json) {
    console.log(JSON.stringify(statusData, null, 2));
    return;
  }

  // Table output
  p.log.step(`Stack: ${manifest.stackName} | Region: ${manifest.region}`);
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
    p.note(urlLines.join("\n"), "Tailscale URLs");
  }
}
