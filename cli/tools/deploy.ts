/**
 * Deploy Tool — Deploy agents with pulumi up
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { loadManifest, resolveConfigName, syncManifestToProject } from "../lib/config";
import { COST_ESTIMATES, HETZNER_COST_ESTIMATES } from "../lib/constants";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { isTailscaleInstalled, isTailscaleRunning, cleanupTailscaleDevices, ensureTailscaleFunnel } from "../lib/tailscale";
import pc from "picocolors";

/**
 * Get Pulumi config value
 */
function getConfig(exec: ExecAdapter, key: string, cwd?: string): string | null {
  const result = exec.capture("pulumi", ["config", "get", key], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export interface DeployOptions {
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Config name (auto-detected if only one) */
  config?: string;
}

/**
 * Format agent list for display
 */
function formatAgentList(
  agents: { displayName: string; role: string; preset: string | null }[]
): string {
  return agents
    .map((a) => {
      const type = a.preset ? `preset:${a.preset}` : "custom";
      return `  ${pc.bold(a.displayName)} (${a.role}) [${type}]`;
    })
    .join("\n");
}

/**
 * Format cost as monthly estimate
 */
function formatCost(monthlyCost: number): string {
  return `~$${monthlyCost}/mo`;
}

/**
 * Deploy tool implementation
 */
export const deployTool: ToolImplementation<DeployOptions> = async (
  runtime: RuntimeAdapter,
  options: DeployOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Agent Army");

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
      ui.log.error(initResult.stderr || selectResult.stderr);
      ui.log.error(`Could not select Pulumi stack "${manifest.stackName}".`);
      process.exit(1);
    }
  }

  // Calculate estimated cost
  const totalCost = manifest.agents.reduce((sum, a) => {
    const costs = manifest.provider === "hetzner" ? HETZNER_COST_ESTIMATES : COST_ESTIMATES;
      return sum + (costs[a.instanceType ?? manifest.instanceType] ?? 30);
  }, 0);

  // Show deployment summary
  ui.note(
    [
      `Stack:    ${manifest.stackName}`,
      `Region:   ${manifest.region}`,
      ``,
      `Agents (${manifest.agents.length}):`,
      formatAgentList(manifest.agents),
      ``,
      `Estimated cost: ${formatCost(totalCost)}`,
    ].join("\n"),
    "Deployment Summary"
  );

  // Confirm deployment
  if (!options.yes) {
    const confirmed = await ui.confirm({
      message: "Proceed with deployment?",
    });
    if (!confirmed) {
      ui.cancel("Deployment cancelled.");
    }
  }

  // Sync manifest to project root so the Pulumi program can read it
  syncManifestToProject(configName, cwd);

  // Sync instanceType from manifest to Pulumi config
  exec.capture("pulumi", ["config", "set", "instanceType", manifest.instanceType], cwd);

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

  // Ensure Tailscale Funnel prerequisites if any agent uses Linear
  const hasLinearAgents = manifest.agents.some(
    (a) => !!getConfig(exec, `${a.role}LinearApiKey`, cwd)
  );
  if (hasLinearAgents && tailscaleApiKey) {
    const spinner = ui.spinner("Ensuring Tailscale Funnel prerequisites...");
    const funnel = ensureTailscaleFunnel(tailscaleApiKey);
    const changes: string[] = [];
    if (funnel.magicDns) changes.push("MagicDNS enabled");
    if (funnel.funnelAcl) changes.push("Funnel ACL enabled");
    spinner.stop(changes.length > 0 ? changes.join(", ") : "Funnel prerequisites OK");
  }

  // Deploy
  ui.log.step("Running pulumi up...");
  console.log();
  const exitCode = await exec.stream("pulumi", ["up", "--yes"], { cwd });
  console.log();

  if (exitCode !== 0) {
    ui.log.error("Deployment failed. Check the output above for details.");
    process.exit(1);
  }

  ui.log.success("Deployment complete!");

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

      // Show webhook URLs if available
      const webhookLines: string[] = [];
      for (const agent of manifest.agents) {
        const webhookUrl = outputs[`${agent.role}WebhookUrl`] as string | undefined;
        if (webhookUrl) {
          webhookLines.push(`  ${agent.displayName} (${agent.role}): ${webhookUrl}`);
        }
      }
      if (webhookLines.length > 0) {
        ui.note(webhookLines.join("\n"), "Webhook URLs");
      }
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

  ui.log.info(
    `Run ${pc.cyan("agent-army webhooks setup")} to configure Linear webhooks for your agents.`
  );

  ui.outro("Agents will be ready in 3-5 minutes. Run `agent-army validate` to check.");
};
