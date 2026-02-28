/**
 * Destroy Tool — Tear down resources with safety confirmations
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation } from "../adapters";
import { requireResolvedManifest, syncManifestToProject } from "../lib/config";
import { cleanupTailscaleDevices } from "../lib/tailscale";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { getConfig, verifyStackOwnership } from "../lib/tool-helpers";
import { formatAgentList } from "../lib/ui";
import { qualifiedStackName } from "../lib/pulumi";
import { getProjectRoot } from "../lib/project";

export interface DestroyOptions {
  /** Skip confirmation prompts (dangerous!) */
  yes?: boolean;
  /** Destroy local Docker containers only */
  local?: boolean;
}

/**
 * Destroy tool implementation
 */
export const destroyTool: ToolImplementation<DestroyOptions> = async (
  runtime: RuntimeAdapter,
  options: DestroyOptions
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
    manifest = { ...manifest, provider: "local" as const };
  }

  // Select/create stack (use org-qualified name if organization is set)
  const stackName = options.local ? `${manifest.stackName}-local` : manifest.stackName;
  const pulumiStack = qualifiedStackName(stackName, manifest.organization);
  const projectRoot = getProjectRoot();
  const selectResult = exec.capture("pulumi", ["stack", "select", pulumiStack], cwd);
  if (selectResult.exitCode !== 0) {
    const initResult = exec.capture("pulumi", ["stack", "init", pulumiStack], cwd);
    if (initResult.exitCode !== 0) {
      ui.log.error(`Could not select Pulumi stack "${pulumiStack}".`);
      process.exit(1);
    }
  } else {
    const collisionError = verifyStackOwnership(exec, projectRoot, cwd);
    if (collisionError) {
      ui.log.error(collisionError);
      process.exit(1);
    }
  }

  // Show what will be destroyed (provider-aware)
  const manifestProvider = manifest.provider ?? "aws";
  const isLocal = manifestProvider === "local";
  const resourceLabel = isLocal
    ? "Docker containers"
    : manifestProvider === "hetzner"
      ? "Hetzner servers"
      : "EC2 instances";
  const infraLabel = isLocal
    ? "Docker networks"
    : manifestProvider === "hetzner"
      ? "Firewall rules"
      : "VPC, subnet, and security group";

  const destroyItems = [
    `  - ${manifest.agents.length} ${resourceLabel}`,
    `  - All workspace data on those ${isLocal ? "containers" : "instances"}`,
    `  - ${infraLabel}`,
  ];
  if (!isLocal) {
    destroyItems.push(`  - Tailscale device registrations`);
  }

  ui.note(
    [
      `Stack:    ${manifest.stackName}`,
      isLocal ? `Provider: Local Docker` : `Region:   ${manifest.region}`,
      ``,
      `Agents (${manifest.agents.length}):`,
      formatAgentList(manifest.agents),
      ``,
      `This will PERMANENTLY DESTROY:`,
      ...destroyItems,
    ].join("\n"),
    "Destruction Plan"
  );

  // Confirm
  if (!options.yes) {
    const typedName = await ui.text({
      message: `Type the stack name to confirm: "${manifest.stackName}"`,
      validate: (val) => {
        if (val !== manifest.stackName) return `Must type "${manifest.stackName}" to confirm`;
        return undefined;
      },
    });

    const confirmed = await ui.confirm({
      message: "Are you ABSOLUTELY sure?",
      initialValue: false,
    });
    if (!confirmed) {
      ui.cancel("Destruction cancelled.");
    }
  }

  // Sync manifest to project root so the Pulumi program can read it
  syncManifestToProject(cwd, options.local ? { provider: "local" as const } : undefined);

  // Destroy infrastructure
  ui.log.step("Running pulumi destroy...");
  console.log();
  const exitCode = await exec.stream("pulumi", ["destroy", "--yes"], { cwd });
  console.log();

  if (exitCode !== 0) {
    ui.log.error("Destruction failed. Check the output above for details.");
    process.exit(1);
  }

  // Clean up Tailscale devices after infrastructure is destroyed (skip for local)
  if (!isLocal) {
    const tailnetDnsName = getConfig(exec, "tailnetDnsName", cwd);
    const tailscaleApiKey = getConfig(exec, "tailscaleApiKey", cwd);

    if (tailnetDnsName && tailscaleApiKey) {
      const spinner = ui.spinner("Removing agents from Tailscale...");
      const { cleaned, failed } = cleanupTailscaleDevices(
        tailscaleApiKey, tailnetDnsName, manifest.stackName, manifest.agents
      );
      if (failed.length === 0) {
        spinner.stop(cleaned.length > 0 ? "Tailscale devices cleaned up" : "No Tailscale devices found");
      } else {
        spinner.stop("Some Tailscale devices could not be removed");
        ui.log.warn(
          `Could not remove: ${failed.join(", ")}. Remove manually from https://login.tailscale.com/admin/machines`
        );
      }
    } else if (tailnetDnsName && !tailscaleApiKey) {
      ui.log.warn("No Tailscale API key configured - devices must be removed manually.");
      console.log("  Remove devices at: https://login.tailscale.com/admin/machines");
      console.log("  Tip: Set a Tailscale API key (`clawup init`) for automatic cleanup.");
    }
  }

  ui.log.success(`Stack "${manifest.stackName}" has been destroyed.`);
  ui.outro("Done!");
};
