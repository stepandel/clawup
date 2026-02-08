/**
 * agent-army destroy — Tear down resources with safety confirmations
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { pulumiDestroy, selectOrCreateStack, getConfig } from "../lib/pulumi";
import { capture } from "../lib/exec";
import { SSH_USER, tailscaleHostname } from "../lib/constants";
import { showBanner, handleCancel, exitWithError, formatAgentList } from "../lib/ui";
import { deleteTailscaleDevice, listTailscaleDevices } from "../lib/tailscale";

interface DestroyOptions {
  yes?: boolean;
}

/**
 * Deregister an agent from Tailscale by SSHing in and running `tailscale logout`.
 * Returns true if successful, false otherwise.
 */
function deregisterTailscale(host: string): boolean {
  const result = capture("ssh", [
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    `${SSH_USER}@${host}`,
    "sudo tailscale down && sudo tailscale logout",
  ]);
  return result.exitCode === 0;
}

export async function destroyCommand(opts: DestroyOptions): Promise<void> {
  showBanner();

  // Load manifest
  const manifest = loadManifest();
  if (!manifest) {
    exitWithError("No agent-army.json found. Run `agent-army init` first.");
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

  // Deregister agents from Tailscale before destroying infrastructure
  const tailnetDnsName = getConfig("tailnetDnsName");
  if (tailnetDnsName) {
    const s = p.spinner();
    s.start("Deregistering agents from Tailscale...");
    const sshFailed: string[] = [];

    for (const agent of manifest.agents) {
      const tsHost = tailscaleHostname(manifest.stackName, agent.name);
      const host = `${tsHost}.${tailnetDnsName}`;
      const ok = deregisterTailscale(host);
      if (!ok) sshFailed.push(agent.name);
    }

    if (sshFailed.length === 0) {
      s.stop("All agents deregistered from Tailscale");
    } else {
      s.stop("SSH deregistration failed for some agents, trying API cleanup...");

      // Fallback: use Tailscale API to delete orphaned devices
      const tailscaleApiKey = getConfig("tailscaleApiKey");
      if (tailscaleApiKey) {
        const apiS = p.spinner();
        apiS.start("Cleaning up via Tailscale API...");
        const apiFailed: string[] = [];

        // Get the tailnet name (org portion before .ts.net, or custom domain)
        const tailnet = tailnetDnsName.replace(/\.ts\.net$/, "");
        const devices = listTailscaleDevices(tailscaleApiKey, tailnet);

        if (devices) {
          for (const agentName of sshFailed) {
            const tsHost = tailscaleHostname(manifest.stackName, agentName);
            const device = devices.find((d) =>
              d.hostname === tsHost || d.name.startsWith(`${tsHost}.`)
            );
            if (device) {
              const deleted = deleteTailscaleDevice(tailscaleApiKey, device.id);
              if (!deleted) apiFailed.push(agentName);
            } else {
              // Device not found — may already be gone
            }
          }
        } else {
          apiFailed.push(...sshFailed);
        }

        if (apiFailed.length === 0) {
          apiS.stop("All orphaned devices cleaned up via API");
        } else {
          apiS.stop("Some devices could not be removed");
          p.log.warn(
            `Could not remove: ${apiFailed.join(", ")}. Remove manually from https://login.tailscale.com/admin/machines`
          );
        }
      } else {
        p.log.warn(
          `Could not deregister: ${sshFailed.join(", ")}. Remove manually from https://login.tailscale.com/admin/machines`
        );
        p.log.message(
          "  Tip: Set a Tailscale API key (`agent-army init`) for automatic cleanup of unreachable devices."
        );
      }
    }
  }

  // Destroy
  p.log.step("Running pulumi destroy...");
  console.log();
  const exitCode = await pulumiDestroy();
  console.log();

  if (exitCode !== 0) {
    exitWithError("Destruction failed. Check the output above for details.");
  }

  p.log.success(`Stack "${manifest.stackName}" has been destroyed.`);
  p.outro("Done!");
}
