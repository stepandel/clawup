/**
 * Redeploy Tool — Update agents in-place with pulumi up --refresh
 *
 * For non-local redeploys, automatically runs setup (secret validation,
 * Pulumi provisioning) before redeploying — no separate `clawup setup` needed.
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 * Unlike destroy+deploy, this reuses existing infrastructure (including Tailscale devices).
 */

import type { RuntimeAdapter, ToolImplementation } from "../adapters";
import { requireResolvedManifest, syncManifestToProject } from "../lib/config";
import type { ClawupManifest, ResolvedManifest } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { runSetup, type SetupProgress } from "../lib/setup";
import { isTailscaleInstalled, isTailscaleRunning, cleanupTailscaleDevices, ensureMagicDns, ensureTailscaleFunnel } from "../lib/tailscale";
import { getConfig, setConfig, verifyStackOwnership, stampStackFingerprint } from "../lib/tool-helpers";
import { formatAgentList } from "../lib/ui";
import { qualifiedStackName } from "../lib/pulumi";
import { getProjectRoot } from "../lib/project";
import pc from "picocolors";

export interface RedeployOptions {
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Run in local Docker containers */
  local?: boolean;
  /** Path to .env file (defaults to .env in project root) */
  envFile?: string;
  /** Skip plugin lifecycle hook execution */
  skipHooks?: boolean;
}

/** Build a SetupProgress adapter from RuntimeAdapter.ui */
function uiToSetupProgress(ui: RuntimeAdapter["ui"]): SetupProgress {
  return {
    spinner: (msg: string) => {
      const s = ui.spinner(msg);
      return { start: (_msg: string) => {/* already started by ui.spinner() */}, stop: (msg: string) => s.stop(msg) };
    },
    log: {
      info: (msg: string) => ui.log.info(msg),
      warn: (msg: string) => ui.log.warn(msg),
      error: (msg: string) => ui.log.error(msg),
      success: (msg: string) => ui.log.success(msg),
    },
  };
}

/**
 * Redeploy tool implementation
 */
export const redeployTool: ToolImplementation<RedeployOptions> = async (
  runtime: RuntimeAdapter,
  options: RedeployOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Clawup");

  // Ensure workspace is set up
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    ui.log.error(wsResult.error ?? "Failed to set up workspace.");
    process.exit(1);
  }

  // For non-local redeploys, run setup automatically (validate .env, configure Pulumi)
  if (!options.local) {
    const setupResult = await runSetup(uiToSetupProgress(ui), {
      envFile: options.envFile,
      skipHooks: options.skipHooks,
    });
    if (!setupResult.ok) {
      ui.log.error(setupResult.error!);
      process.exit(1);
    }
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
  const isLocal = !!options.local;
  if (isLocal) {
    manifest = { ...manifest, provider: "local" } as ResolvedManifest;
  }

  // Try to select existing stack (use org-qualified name if organization is set)
  const stackName = isLocal ? `${manifest.stackName}-local` : manifest.stackName;
  const pulumiStack = qualifiedStackName(stackName, manifest.organization);
  const projectRoot = getProjectRoot();
  const selectResult = exec.capture("pulumi", ["stack", "select", pulumiStack], cwd);
  const stackExists = selectResult.exitCode === 0;

  if (!stackExists) {
    // Stack doesn't exist — fall back to regular deploy flow
    ui.log.warn(`Stack "${manifest.stackName}" does not exist. Falling back to fresh deploy.`);

    const initResult = exec.capture("pulumi", ["stack", "init", pulumiStack], cwd);
    if (initResult.exitCode !== 0) {
      ui.log.error(initResult.stderr || `Could not create Pulumi stack "${pulumiStack}".`);
      process.exit(1);
    }
    stampStackFingerprint(exec, projectRoot, cwd);
  } else if (isLocal) {
    // Only verify ownership for local stacks (non-local already verified by runSetup)
    const collisionError = verifyStackOwnership(exec, projectRoot, cwd);
    if (collisionError) {
      ui.log.error(collisionError);
      process.exit(1);
    }
  }

  // Show redeploy summary
  ui.note(
    [
      `Stack:    ${manifest.stackName}`,
      isLocal ? `Provider: Local Docker` : `Region:   ${manifest.region}`,
      `Mode:     ${stackExists ? "In-place update (--refresh)" : "Fresh deploy (new stack)"}`,
      ``,
      `Agents (${manifest.agents.length}):`,
      formatAgentList(manifest.agents),
      ``,
      stackExists
        ? isLocal
          ? `This will update local Docker containers in-place.`
          : `This will update resources in-place where possible.\nTailscale devices will be preserved.`
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
  syncManifestToProject(cwd, isLocal ? { provider: "local" as const } : undefined);

  // --local: auto-configure by copying all config from the cloud stack
  if (isLocal) {
    // Sync instanceType from manifest to Pulumi config
    const configSetResult = exec.capture("pulumi", ["config", "set", "instanceType", manifest.instanceType], cwd);
    if (configSetResult.exitCode !== 0) {
      ui.log.error(`Failed to set Pulumi config: ${configSetResult.stderr || "unknown error"}`);
      process.exit(1);
    }

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
        ui.log.warn("No cloud stack found and ANTHROPIC_API_KEY not set.");
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
  if (!isLocal) {
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
    if (tailscaleApiKey) {
      const hasLinearAgents = manifest.agents.some(
        (a) => !!getConfig(exec, `${a.role}LinearApiKey`, cwd)
      );
      if (hasLinearAgents) {
        const spinner = ui.spinner("Ensuring Tailscale Funnel prerequisites...");
        const funnel = ensureTailscaleFunnel(tailscaleApiKey);
        const changes: string[] = [];
        if (funnel.funnelAcl) changes.push("Funnel ACL enabled");
        spinner.stop(changes.length > 0 ? changes.join(", ") : "Funnel prerequisites OK");
      }
    }
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

  if (isLocal) {
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

    ui.outro("Agents updated. Run `clawup validate` to verify.");
  }
};
