/**
 * agent-army destroy — Tear down resources with safety confirmations
 */

import * as p from "@clack/prompts";
import { loadManifest, resolveConfigName, checkAndMigrateLegacy, deleteManifest, configPath } from "../lib/config";
import { pulumiDestroy, selectOrCreateStack, getConfig } from "../lib/pulumi";
import { capture } from "../lib/exec";
import { SSH_USER, tailscaleHostname } from "../lib/constants";
import { showBanner, handleCancel, exitWithError, formatAgentList } from "../lib/ui";
import { deleteTailscaleDevice, listTailscaleDevices } from "../lib/tailscale";

interface DestroyOptions {
  yes?: boolean;
  config?: string;
}

/**
 * DEPRECATED: SSH-based Tailscale deregistration is no longer used.
 *
 * We now clean up Tailscale devices AFTER Pulumi destroy completes, which is safer
 * (preserves SSH access if destroy fails) and must use the Tailscale API since
 * instances are already destroyed.
 *
 * This function is kept for reference but should not be called.
 */
function deregisterTailscale(host: string): boolean {
  const result = capture("ssh", [
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "BatchMode=yes",
    `${SSH_USER}@${host}`,
    "nohup sh -c 'sleep 1 && sudo tailscale down && sudo tailscale logout' >/dev/null 2>&1 &",
  ]);
  return result.exitCode === 0;
}

export async function destroyCommand(opts: DestroyOptions): Promise<void> {
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
    exitWithError(`Could not select Pulumi stack "${manifest.stackName}".`);
  }

  // Show what will be destroyed
  p.note(
    [
      `Stack:  ${manifest.stackName}`,
      `Region: ${manifest.region}`,
      ``,
      `Agents (${manifest.agents.length}):`,
      formatAgentList(manifest.agents),
      ``,
      `This will PERMANENTLY DESTROY:`,
      `  - ${manifest.agents.length} EC2 instances`,
      `  - All workspace data on those instances`,
      `  - VPC, subnet, and security group`,
      `  - Tailscale device registrations`,
    ].join("\n"),
    "Destruction Plan"
  );

  // Confirm
  if (!opts.yes) {
    const typedName = await p.text({
      message: `Type the stack name to confirm: "${manifest.stackName}"`,
      validate: (val) => {
        if (val !== manifest.stackName) return `Must type "${manifest.stackName}" to confirm`;
      },
    });
    handleCancel(typedName);

    const confirmed = await p.confirm({
      message: "Are you ABSOLUTELY sure?",
      initialValue: false,
    });
    handleCancel(confirmed);
    if (!confirmed) {
      p.cancel("Destruction cancelled.");
      process.exit(0);
    }
  }

  // Destroy infrastructure first (keep Tailscale access until after destroy completes)
  p.log.step("Running pulumi destroy...");
  console.log();
  const exitCode = await pulumiDestroy();
  console.log();

  if (exitCode !== 0) {
    exitWithError("Destruction failed. Check the output above for details.");
  }

  // Clean up Tailscale devices after infrastructure is destroyed
  const tailnetDnsName = getConfig("tailnetDnsName");
  const tailscaleApiKey = getConfig("tailscaleApiKey");

  if (tailnetDnsName && tailscaleApiKey) {
    // Use Tailscale API for cleanup (only method that works after instances are destroyed)
    const s = p.spinner();
    s.start("Removing agents from Tailscale...");
    const apiFailed: string[] = [];

    // Use the full tailnet DNS name for API calls (API expects "tailnet.ts.net")
    const tailnet = tailnetDnsName;
    const devices = listTailscaleDevices(tailscaleApiKey, tailnet);

    if (devices) {
      for (const agent of manifest.agents) {
        const tsHost = tailscaleHostname(manifest.stackName, agent.name);
        const device = devices.find((d) =>
          d.hostname === tsHost || d.name.startsWith(`${tsHost}.`)
        );
        if (device) {
          const deleted = deleteTailscaleDevice(tailscaleApiKey, device.id);
          if (!deleted) apiFailed.push(agent.name);
        }
        // If device not found, it's already gone - which is expected since instances were destroyed
      }

      if (apiFailed.length === 0) {
        s.stop("Tailscale devices cleaned up");
      } else {
        s.stop("Some Tailscale devices could not be removed");
        p.log.warn(
          `Could not remove: ${apiFailed.join(", ")}. Remove manually from https://login.tailscale.com/admin/machines`
        );
      }
    } else {
      s.stop("Could not list Tailscale devices");
      p.log.warn("Manual cleanup may be needed at https://login.tailscale.com/admin/machines");
    }
  } else if (tailnetDnsName && !tailscaleApiKey) {
    p.log.warn("No Tailscale API key configured - devices must be removed manually.");
    p.log.message("  Remove devices at: https://login.tailscale.com/admin/machines");
    p.log.message("  Tip: Set a Tailscale API key (`agent-army init`) for automatic cleanup.");
  }

  p.log.success(`Stack "${manifest.stackName}" has been destroyed.`);
  p.outro("Done!");
}
