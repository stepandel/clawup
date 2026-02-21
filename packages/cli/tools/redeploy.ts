/**
 * Redeploy Tool — Update agents in-place with pulumi up --refresh
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 * Unlike destroy+deploy, this reuses existing infrastructure (including Tailscale devices).
 */

import type { RuntimeAdapter, ToolImplementation } from "../adapters";
import { loadManifest, resolveConfigName, syncManifestToProject } from "../lib/config";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { isTailscaleInstalled, isTailscaleRunning, cleanupTailscaleDevices, ensureMagicDns, ensureTailscaleFunnel } from "../lib/tailscale";
import { getConfig } from "../lib/tool-helpers";
import { formatAgentList } from "../lib/ui";
import pc from "picocolors";

export interface RedeployOptions {
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Config name (auto-detected if only one) */
  config?: string;
}

/**
 * Redeploy tool implementation
 */
export const redeployTool: ToolImplementation<RedeployOptions> = async (
  runtime: RuntimeAdapter,
  options: RedeployOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Agent Army");

  // Ensure workspace is set up
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

  // Try to select existing stack
  const selectResult = exec.capture("pulumi", ["stack", "select", manifest.stackName], cwd);
  const stackExists = selectResult.exitCode === 0;

  if (!stackExists) {
    // Stack doesn't exist — fall back to regular deploy flow
    ui.log.warn(`Stack "${manifest.stackName}" does not exist. Falling back to fresh deploy.`);

    const initResult = exec.capture("pulumi", ["stack", "init", manifest.stackName], cwd);
    if (initResult.exitCode !== 0) {
      ui.log.error(initResult.stderr || `Could not create Pulumi stack "${manifest.stackName}".`);
      process.exit(1);
    }
  }

  // Show redeploy summary
  ui.note(
    [
      `Stack:    ${manifest.stackName}`,
      `Region:   ${manifest.region}`,
      `Mode:     ${stackExists ? "In-place update (--refresh)" : "Fresh deploy (new stack)"}`,
      ``,
      `Agents (${manifest.agents.length}):`,
      formatAgentList(manifest.agents),
      ``,
      stackExists
        ? `This will update resources in-place where possible.\nTailscale devices will be preserved.`
        : `This will create all resources from scratch.`,
    ].join("\n"),
    "Redeploy Summary"
  );

  // Confirm
  if (!options.yes) {
    const confirmed = await ui.confirm({
      message: "Proceed with redeploy?",
    });
    if (!confirmed) {
      ui.cancel("Redeploy cancelled.");
      return;
    }
  }

  // Sync manifest to project root so the Pulumi program can read it
  syncManifestToProject(configName, cwd);

  // Sync instanceType from manifest to Pulumi config
  const configSetResult = exec.capture("pulumi", ["config", "set", "instanceType", manifest.instanceType], cwd);
  if (configSetResult.exitCode !== 0) {
    ui.log.error(`Failed to set Pulumi config: ${configSetResult.stderr || "unknown error"}`);
    process.exit(1);
  }

  // Clean up stale Tailscale devices before deploying
  // This prevents duplicates when Pulumi replaces servers (create-before-delete)
  const tailnetDnsName = getConfig(exec, "tailnetDnsName", cwd);
  const tailscaleApiKey = getConfig(exec, "tailscaleApiKey", cwd);

  if (tailnetDnsName && tailscaleApiKey) {
    const spinner = ui.spinner("Cleaning up stale Tailscale devices...");
    const { cleaned, failed } = cleanupTailscaleDevices(
      tailscaleApiKey, tailnetDnsName, manifest.stackName, manifest.agents
    );
    if (cleaned.length > 0) {
      spinner.stop(`Removed ${cleaned.length} stale Tailscale device(s)`);
    } else {
      spinner.stop("No stale Tailscale devices found");
    }
    if (failed.length > 0) {
      ui.log.warn(
        `Could not remove some devices: ${failed.join(", ")}. Check https://login.tailscale.com/admin/machines`
      );
    }
  }

  // Ensure MagicDNS is enabled (required for Tailscale hostname resolution)
  if (tailscaleApiKey) {
    const spinner = ui.spinner("Ensuring Tailscale MagicDNS is enabled...");
    const magicDnsChanged = ensureMagicDns(tailscaleApiKey);
    spinner.stop(magicDnsChanged ? "MagicDNS enabled" : "MagicDNS OK");
  }

  // Ensure Tailscale Funnel prerequisites if any agent uses Linear
  const hasLinearAgents = manifest.agents.some(
    (a) => !!getConfig(exec, `${a.role}LinearApiKey`, cwd)
  );
  if (hasLinearAgents && tailscaleApiKey) {
    const spinner = ui.spinner("Ensuring Tailscale Funnel prerequisites...");
    const funnel = ensureTailscaleFunnel(tailscaleApiKey);
    const changes: string[] = [];
    if (funnel.funnelAcl) changes.push("Funnel ACL enabled");
    spinner.stop(changes.length > 0 ? changes.join(", ") : "Funnel prerequisites OK");
  }

  // Run pulumi up with --refresh to read actual cloud state first
  const pulumiArgs = stackExists
    ? ["up", "--refresh", "--yes"]
    : ["up", "--yes"];

  ui.log.step(stackExists ? "Running pulumi up --refresh..." : "Running pulumi up...");
  console.log();
  const exitCode = await exec.stream("pulumi", pulumiArgs, { cwd });
  console.log();

  if (exitCode !== 0) {
    ui.log.error("Redeploy failed. Check the output above for details.");
    if (stackExists) {
      ui.log.warn(
        "If the in-place update cannot recover, try: clawup destroy && clawup deploy"
      );
    }
    process.exit(1);
  }

  ui.log.success("Redeploy complete!");

  // Show outputs
  const outputsResult = exec.capture("pulumi", [
    "stack",
    "output",
    "--json",
    "--show-secrets",
  ], cwd);
  if (outputsResult.exitCode === 0) {
    try {
      const outputs = JSON.parse(outputsResult.stdout) as Record<string, unknown>;
      const lines: string[] = [];

      for (const agent of manifest.agents) {
        const urlKey = `${agent.role}TailscaleUrl`;
        const ipKey = `${agent.role}PublicIp`;
        const idKey = `${agent.role}InstanceId`;
        lines.push(`${agent.displayName} (${agent.role}):`);
        if (outputs[urlKey]) lines.push(`  Tailscale URL: ${outputs[urlKey]}`);
        if (outputs[ipKey]) lines.push(`  Public IP:     ${outputs[ipKey]}`);
        if (outputs[idKey]) lines.push(`  Instance ID:   ${outputs[idKey]}`);
        lines.push("");
      }

      ui.note(lines.join("\n"), "Agent Details");
    } catch (err) {
      ui.log.warn(`Could not parse stack outputs: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remind user about Tailscale if not connected
  if (!isTailscaleInstalled()) {
    const hint =
      process.platform === "darwin"
        ? "Install from the Mac App Store or https://tailscale.com/download"
        : "Install from https://tailscale.com/download";
    ui.log.warn(
      `Tailscale is required to connect to agents.\n  ${hint}\n  Then run: ${pc.cyan("tailscale up")}`
    );
  } else if (!isTailscaleRunning()) {
    ui.log.warn(
      `Tailscale is not running. Start it before validating agents.\n  Open the Tailscale app or run: ${pc.cyan("tailscale up")}`
    );
  }

  ui.outro("Agents updated. Run `clawup validate` to verify.");
};
