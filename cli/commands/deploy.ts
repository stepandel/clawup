/**
 * agent-army deploy — Deploy agents with pulumi up
 */

import * as p from "@clack/prompts";
import { loadManifest, resolveConfigName, checkAndMigrateLegacy } from "../lib/config";
import { pulumiUp, getStackOutputs, selectOrCreateStack } from "../lib/pulumi";
import { showBanner, handleCancel, exitWithError, formatCost, formatAgentList } from "../lib/ui";
import { COST_ESTIMATES } from "../lib/constants";

interface DeployOptions {
  yes?: boolean;
  config?: string;
}

export async function deployCommand(opts: DeployOptions): Promise<void> {
  showBanner();

  // Check for legacy config and offer migration
  await checkAndMigrateLegacy();

  // Resolve config name
  let configName: string;
  try {
    configName = resolveConfigName(opts.config);
  } catch (err) {
    exitWithError((err as Error).message);
  }

  // Load manifest
  const manifest = loadManifest(configName);
  if (!manifest) {
    exitWithError(`Config '${configName}' could not be loaded.`);
  }

  // Select stack
  const stackResult = selectOrCreateStack(manifest.stackName);
  if (!stackResult.ok) {
    if (stackResult.error) p.log.error(stackResult.error);
    exitWithError(`Could not select Pulumi stack "${manifest.stackName}".`);
  }

  // Show deployment summary
  const totalCost = manifest.agents.reduce((sum, a) => {
    return sum + (COST_ESTIMATES[a.instanceType ?? manifest.instanceType] ?? 30);
  }, 0);

  p.note(
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

  // Confirm
  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: "Proceed with deployment?",
    });
    handleCancel(confirmed);
    if (!confirmed) {
      p.cancel("Deployment cancelled.");
      process.exit(0);
    }
  }

  // Deploy
  p.log.step("Running pulumi up...");
  console.log();
  const exitCode = await pulumiUp();
  console.log();

  if (exitCode !== 0) {
    exitWithError("Deployment failed. Check the output above for details.");
  }

  p.log.success("Deployment complete!");

  // Show outputs
  const outputs = getStackOutputs(true);
  if (outputs) {
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
    p.note(lines.join("\n"), "Agent Details");
  }

  p.outro("Agents will be ready in 3-5 minutes. Run `agent-army validate` to check.");
}
