/**
 * agent-army destroy — Tear down resources with safety confirmations
 */

import * as p from "@clack/prompts";
import { loadManifest } from "../lib/config";
import { pulumiDestroy, selectOrCreateStack } from "../lib/pulumi";
import { showBanner, handleCancel, exitWithError, formatAgentList } from "../lib/ui";

interface DestroyOptions {
  yes?: boolean;
}

export async function destroyCommand(opts: DestroyOptions): Promise<void> {
  showBanner();

  // Load manifest
  const manifest = loadManifest();
  if (!manifest) {
    exitWithError("No agent-army.json found. Run `agent-army init` first.");
  }

  // Select stack
  if (!selectOrCreateStack(manifest.stackName)) {
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

  // Destroy
  p.log.step("Running pulumi destroy...");
  console.log();
  const exitCode = await pulumiDestroy();
  console.log();

  if (exitCode !== 0) {
    exitWithError("Destruction failed. Check the output above for details.");
  }

  p.log.success(`Stack "${manifest.stackName}" has been destroyed.`);
  p.outro("Tailscale nodes may take a few minutes to disappear. Check with: tailscale status");
}
