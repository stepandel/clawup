/**
 * agent-army destroy — Tear down resources with safety confirmations
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { pulumiDestroy, selectOrCreateStack, getConfig } from "../lib/pulumi";
import { capture } from "../lib/exec";
import { SSH_USER } from "../lib/constants";
import { showBanner, handleCancel, exitWithError, formatAgentList } from "../lib/ui";

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
    const failed: string[] = [];

    for (const agent of manifest.agents) {
      const host = `${agent.name}.${tailnetDnsName}`;
      const ok = deregisterTailscale(host);
      if (!ok) failed.push(agent.displayName);
    }

    if (failed.length === 0) {
      s.stop("All agents deregistered from Tailscale");
    } else {
      s.stop("Some agents could not be deregistered");
      p.log.warn(
        `Could not deregister: ${failed.join(", ")}. Remove manually from https://login.tailscale.com/admin/machines`
      );
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
