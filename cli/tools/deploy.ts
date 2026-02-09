/**
 * Deploy Tool — Deploy agents with pulumi up
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation } from "../adapters";
import { loadManifest, resolveConfigName } from "../lib/config";
import { COST_ESTIMATES } from "../lib/constants";
import pc from "picocolors";

export interface DeployOptions {
  /** Skip confirmation prompt */
  yes?: boolean;
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

  // Resolve config name and load manifest
  let configName: string;
  try {
    configName = resolveConfigName();
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
  const selectResult = exec.capture("pulumi", ["stack", "select", manifest.stackName]);
  if (selectResult.exitCode !== 0) {
    const initResult = exec.capture("pulumi", ["stack", "init", manifest.stackName]);
    if (initResult.exitCode !== 0) {
      ui.log.error(initResult.stderr || selectResult.stderr);
      ui.log.error(`Could not select Pulumi stack "${manifest.stackName}".`);
      process.exit(1);
    }
  }

  // Calculate estimated cost
  const totalCost = manifest.agents.reduce((sum, a) => {
    return sum + (COST_ESTIMATES[a.instanceType ?? manifest.instanceType] ?? 30);
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

  // Deploy
  ui.log.step("Running pulumi up...");
  console.log();
  const exitCode = await exec.stream("pulumi", ["up", "--yes"]);
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
  ]);
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
    } catch {
      // Ignore parse errors
    }
  }

  ui.outro("Agents will be ready in 3-5 minutes. Run `agent-army validate` to check.");
};
