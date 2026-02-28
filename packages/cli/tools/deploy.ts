/**
 * Deploy Tool — Deploy agents with pulumi up
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation } from "../adapters";
import { requireResolvedManifest, syncManifestToProject } from "../lib/config";
import { COST_ESTIMATES, HETZNER_COST_ESTIMATES, LOCAL_COST_ESTIMATES, resolvePlugin } from "@clawup/core";
import type { ClawupManifest, ResolvedManifest } from "@clawup/core";
import { fetchIdentitySync } from "@clawup/core/identity";
import * as path from "path";
import * as os from "os";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { isTailscaleInstalled, isTailscaleRunning, cleanupTailscaleDevices, ensureMagicDns, ensureTailscaleFunnel } from "../lib/tailscale";
import { getConfig, setConfig, verifyStackOwnership, stampStackFingerprint } from "../lib/tool-helpers";
import { formatAgentList, formatCost } from "../lib/ui";
import { qualifiedStackName } from "../lib/pulumi";
import { getProjectRoot } from "../lib/project";
import pc from "picocolors";

export interface DeployOptions {
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Run in local Docker containers (for testing) */
  local?: boolean;
}

/**
 * Deploy tool implementation
 */
export const deployTool: ToolImplementation<DeployOptions> = async (
  runtime: RuntimeAdapter,
  options: DeployOptions
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

  // Load manifest (resolves agent fields from identities)
  let manifest;
  try {
    manifest = requireResolvedManifest();
  } catch (err) {
    ui.log.error((err as Error).message);
    process.exit(1);
  }

  // --local: override provider in memory, use separate stack
  if (options.local) {
    manifest = { ...manifest, provider: "local" } as ResolvedManifest;
  }

  // Select/create stack (use org-qualified name if organization is set)
  const stackName = options.local ? `${manifest.stackName}-local` : manifest.stackName;
  const pulumiStack = qualifiedStackName(stackName, manifest.organization);
  const projectRoot = getProjectRoot();
  const selectResult = exec.capture("pulumi", ["stack", "select", pulumiStack], cwd);
  if (selectResult.exitCode !== 0) {
    const initResult = exec.capture("pulumi", ["stack", "init", pulumiStack], cwd);
    if (initResult.exitCode !== 0) {
      ui.log.error(initResult.stderr || selectResult.stderr);
      ui.log.error(`Could not select Pulumi stack "${pulumiStack}".`);
      process.exit(1);
    }
    stampStackFingerprint(exec, projectRoot, cwd);
  } else {
    const collisionError = verifyStackOwnership(exec, projectRoot, cwd);
    if (collisionError) {
      ui.log.error(collisionError);
      process.exit(1);
    }
  }

  // Calculate estimated cost
  const totalCost = manifest.agents.reduce((sum, a) => {
    if (manifest.provider === "local") return sum;
    const costs = manifest.provider === "hetzner" ? HETZNER_COST_ESTIMATES : COST_ESTIMATES;
      return sum + (costs[a.instanceType ?? manifest.instanceType] ?? 30);
  }, 0);

  // Show deployment summary
  const isLocal = manifest.provider === "local";
  const summaryLines = [
    `Stack:    ${manifest.stackName}`,
    isLocal ? `Provider: Local Docker` : `Region:   ${manifest.region}`,
    ``,
    `Agents (${manifest.agents.length}):`,
    formatAgentList(manifest.agents),
  ];
  if (!isLocal) {
    summaryLines.push(``, `Estimated cost: ${formatCost(totalCost)}`);
  }
  ui.note(summaryLines.join("\n"), "Deployment Summary");

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
  syncManifestToProject(cwd, options.local ? { provider: "local" as const } : undefined);

  // Sync instanceType from manifest to Pulumi config
  exec.capture("pulumi", ["config", "set", "instanceType", manifest.instanceType], cwd);

  // --local: auto-configure by copying all config from the cloud stack
  if (options.local) {
    const cloudStack = qualifiedStackName(manifest.stackName, manifest.organization);
    const configResult = exec.capture("pulumi", ["config", "--json", "--show-secrets", "--stack", cloudStack], cwd);

    if (configResult.exitCode === 0 && configResult.stdout?.trim()) {
      try {
        const cloudConfig = JSON.parse(configResult.stdout) as Record<string, { value: string; secret: boolean }>;
        const spinner = ui.spinner("Copying config from cloud stack...");
        let copied = 0;
        for (const [key, entry] of Object.entries(cloudConfig)) {
          // Skip Tailscale keys and cloud-specific config
          if (key.includes("tailscale") || key.includes("tailnet") || key === "clawup:projectFingerprint") continue;
          // Strip namespace prefix (e.g., "clawup:anthropicApiKey" → "anthropicApiKey")
          const shortKey = key.includes(":") ? key.split(":").slice(1).join(":") : key;
          setConfig(exec, shortKey, entry.value, cwd, entry.secret);
          copied++;
        }
        spinner.stop(`Copied ${copied} config values from cloud stack`);
      } catch {
        ui.log.warn("Could not parse cloud stack config. Falling back to env var.");
      }
    } else {
      // No cloud stack — fall back to ANTHROPIC_API_KEY env var
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (anthropicKey) {
        setConfig(exec, "anthropicApiKey", anthropicKey, cwd, true);
      } else {
        ui.log.warn("No cloud stack found and ANTHROPIC_API_KEY not set. Run `clawup setup` first.");
      }
    }

    // Override local-specific values
    setConfig(exec, "provider", "local", cwd);
    setConfig(exec, "instanceType", "local", cwd);
    if (manifest.ownerName) setConfig(exec, "ownerName", manifest.ownerName, cwd);
    if (manifest.timezone) setConfig(exec, "timezone", manifest.timezone, cwd);
    if (manifest.workingHours) setConfig(exec, "workingHours", manifest.workingHours, cwd);
    if (manifest.userNotes) setConfig(exec, "userNotes", manifest.userNotes, cwd);
  }

  // Tailscale setup (skip for local Docker provider)
  if (manifest.provider !== "local") {
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

    // Ensure Tailscale Funnel prerequisites (identity plugins may need webhooks)
    if (tailscaleApiKey) {
      const spinner = ui.spinner("Ensuring Tailscale Funnel prerequisites...");
      const funnel = ensureTailscaleFunnel(tailscaleApiKey);
      const changes: string[] = [];
      if (funnel.funnelAcl) changes.push("Funnel ACL enabled");
      spinner.stop(changes.length > 0 ? changes.join(", ") : "Funnel prerequisites OK");
    }
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

      // Show webhook URLs if available (keys are ${role}${PluginSlug}WebhookUrl)
      const webhookLines: string[] = [];
      for (const agent of manifest.agents) {
        const prefix = `${agent.role}`;
        const suffix = "WebhookUrl";
        for (const [key, value] of Object.entries(outputs)) {
          if (key.startsWith(prefix) && key.endsWith(suffix) && key !== `${prefix}${suffix}`) {
            webhookLines.push(`  ${agent.displayName} (${agent.role}): ${value}`);
          }
        }
      }
      if (webhookLines.length > 0) {
        ui.note(webhookLines.join("\n"), "Webhook URLs");
      }
    } catch (err) {
      ui.log.warn(`Could not parse stack outputs: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (manifest.provider === "local") {
    ui.log.info("Agents are running in local Docker containers.");
    ui.outro("Run `clawup validate` to check agent health.");
  } else {
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

    // Check if any agent has plugins with webhookSetup — show generic message
    const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
    const webhookPluginNames = new Set<string>();
    for (const agent of manifest.agents) {
      try {
        const identity = fetchIdentitySync(agent.identity, identityCacheDir);
        for (const pluginName of identity.manifest.plugins ?? []) {
          const pluginManifest = resolvePlugin(pluginName, identity);
          if (pluginManifest.webhookSetup) {
            webhookPluginNames.add(pluginManifest.displayName);
          }
        }
      } catch (err) {
        ui.log.warn(
          `Could not evaluate webhook-capable plugins for agent "${agent.role}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (webhookPluginNames.size > 0) {
      const pluginList = [...webhookPluginNames].join(", ");
      ui.log.info(
        `Run ${pc.cyan("clawup webhooks setup")} to configure ${pluginList} webhooks for your agents.`
      );
    }

    ui.outro("Agents will be ready in 3-5 minutes. Run `clawup validate` to check.");
  }
};
