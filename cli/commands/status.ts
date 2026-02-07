/**
 * agent-army status — Show agent statuses from stack outputs
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { getStackOutputs, selectOrCreateStack } from "../lib/pulumi";
import { showBanner, exitWithError } from "../lib/ui";

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  if (!opts.json) showBanner();

  // Load manifest
  const manifest = loadManifest();
  if (!manifest) {
    exitWithError("No agent-army.json found. Run `agent-army init` first.");
  }

  // Select stack
  if (!selectOrCreateStack(manifest.stackName)) {
    exitWithError(`Could not select Pulumi stack "${manifest.stackName}".`);
  }

  // Get outputs
  const outputs = getStackOutputs(true);
  if (!outputs) {
    exitWithError("Could not fetch stack outputs. Has the stack been deployed?");
  }

  // Build status data
  const statusData = manifest.agents.map((agent) => ({
    name: agent.displayName,
    role: agent.role,
    instanceId: (outputs[`${agent.role}InstanceId`] as string) ?? "—",
    publicIp: (outputs[`${agent.role}PublicIp`] as string) ?? "—",
    tailscaleUrl: (outputs[`${agent.role}TailscaleUrl`] as string) ?? "—",
  }));

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

  const header = [
    "Agent".padEnd(nameW),
    "Role".padEnd(roleW),
    "Instance ID".padEnd(idW),
    "Public IP".padEnd(ipW),
  ].join("  ");

  const separator = [
    "─".repeat(nameW),
    "─".repeat(roleW),
    "─".repeat(idW),
    "─".repeat(ipW),
  ].join("  ");

  console.log(`  ${header}`);
  console.log(`  ${separator}`);

  for (const s of statusData) {
    const row = [
      s.name.padEnd(nameW),
      s.role.padEnd(roleW),
      s.instanceId.padEnd(idW),
      s.publicIp.padEnd(ipW),
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
