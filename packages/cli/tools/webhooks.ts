/**
 * Webhooks Setup Tool — Configure Linear webhooks for deployed agents
 *
 * Collects signing secrets, stores them in Pulumi config for persistence,
 * then applies them live via SSH (no redeploy needed).
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { loadManifest, resolveConfigName } from "../lib/config";
import { SSH_USER, tailscaleHostname } from "@clawup/core";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { getConfig, getStackOutputs } from "../lib/tool-helpers";
import pc from "picocolors";

export interface WebhooksSetupOptions {
  /** Config name (auto-detected if only one) */
  config?: string;
}

/** SSH options for non-interactive connections */
const SSH_OPTS = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "BatchMode=yes",
];

/**
 * Run a command over SSH
 */
function sshExec(
  exec: ExecAdapter,
  host: string,
  command: string,
): { ok: boolean; output: string } {
  const result = exec.capture("ssh", [
    "-o", "ConnectTimeout=15",
    ...SSH_OPTS,
    `${SSH_USER}@${host}`,
    `"${command.replace(/"/g, '\\"')}"`,
  ]);
  return { ok: result.exitCode === 0, output: result.stdout || result.stderr };
}

/**
 * Webhooks setup tool implementation
 */
export const webhooksSetupTool: ToolImplementation<WebhooksSetupOptions> = async (
  runtime: RuntimeAdapter,
  options: WebhooksSetupOptions
) => {
  const { ui, exec } = runtime;

  ui.intro("Agent Army — Webhook Setup");

  // Ensure workspace is set up
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

  // Select stack
  const selectResult = exec.capture("pulumi", ["stack", "select", manifest.stackName], cwd);
  if (selectResult.exitCode !== 0) {
    ui.log.error(`Could not select Pulumi stack "${manifest.stackName}". Run ${pc.cyan("clawup deploy")} first.`);
    process.exit(1);
  }

  // Get stack outputs
  const outputs = getStackOutputs(exec, true, cwd);
  if (!outputs) {
    ui.log.error(`Could not fetch stack outputs. Run ${pc.cyan("clawup deploy")} first.`);
    process.exit(1);
  }

  // Get tailnet DNS name for SSH
  const tailnetDnsName = getConfig(exec, "tailnetDnsName", cwd);
  if (!tailnetDnsName) {
    ui.log.error("Could not read tailnetDnsName from Pulumi config.");
    process.exit(1);
  }

  // Check if any webhook URLs exist
  const agentsWithUrls = manifest.agents.filter(
    (agent) => outputs[`${agent.role}WebhookUrl`]
  );

  if (agentsWithUrls.length === 0) {
    ui.log.error(
      "No webhook URLs found in stack outputs.\n" +
      `  Make sure agents are deployed and exposing webhook endpoints.\n` +
      `  Run ${pc.cyan("clawup deploy")} if you haven't already.`
    );
    process.exit(1);
  }

  ui.note(
    [
      "This will walk you through creating Linear webhooks for each agent.",
      "You'll need access to your Linear workspace settings.",
    ].join("\n"),
    "Linear Webhook Setup"
  );

  // Collect webhook secrets for each agent
  const secrets: { role: string; name: string; agentName: string; secret: string }[] = [];

  for (const agent of manifest.agents) {
    const webhookUrl = outputs[`${agent.role}WebhookUrl`] as string | undefined;
    if (!webhookUrl) {
      ui.log.warn(`No webhook URL found for ${agent.displayName} (${agent.role}) — skipping.`);
      continue;
    }

    ui.note(
      [
        `Webhook URL: ${pc.cyan(String(webhookUrl))}`,
        "",
        "Steps:",
        "1. Go to Linear Settings → API → Webhooks → \"New webhook\"",
        "2. Paste the URL above",
        "3. Select events to receive (e.g., Issues, Comments)",
        "4. Create the webhook and copy the \"Signing secret\"",
      ].join("\n"),
      `${agent.displayName} (${agent.role})`
    );

    const secret = await ui.text({
      message: `Signing secret for ${agent.displayName}`,
      placeholder: "Paste the signing secret from Linear",
      validate: (val: string) => {
        if (!val) return "Signing secret is required";
      },
    });

    secrets.push({
      role: agent.role,
      name: agent.name,
      agentName: agent.displayName,
      secret: secret as string,
    });
  }

  if (secrets.length === 0) {
    ui.log.warn("No webhook secrets collected.");
    ui.outro("Nothing to do.");
    return;
  }

  // Store secrets in Pulumi config (for persistence across deploys)
  const configSpinner = ui.spinner("Saving webhook secrets to Pulumi config...");
  for (const { role, secret } of secrets) {
    exec.capture(
      "pulumi",
      ["config", "set", `${role}LinearWebhookSecret`, secret, "--secret"],
      cwd
    );
  }
  configSpinner.stop(`Saved ${secrets.length} webhook secret(s) to Pulumi config`);

  // Apply secrets live via SSH
  const applySpinner = ui.spinner("Applying webhook secrets to running agents...");
  let applied = 0;
  let failed = 0;

  for (const { role, name, agentName, secret } of secrets) {
    const tsHost = tailscaleHostname(manifest.stackName, name);
    const host = `${tsHost}.${tailnetDnsName}`;

    // Escape the secret for use inside jq
    const escapedSecret = secret.replace(/'/g, "'\\''");
    const jqCmd =
      `jq '.plugins.entries.linear.config.webhookSecret = \\\"${escapedSecret.replace(/\\/g, "\\\\").replace(/"/g, '\\\\\\"')}\\\"' ` +
      `/home/${SSH_USER}/.openclaw/openclaw.json > /tmp/openclaw-patched.json && ` +
      `mv /tmp/openclaw-patched.json /home/${SSH_USER}/.openclaw/openclaw.json`;

    const patchResult = sshExec(exec, host, jqCmd);
    if (!patchResult.ok) {
      applySpinner.stop(`Failed to patch config on ${agentName}`);
      ui.log.warn(`  ${agentName}: ${patchResult.output}`);
      failed++;
      continue;
    }

    const restartResult = sshExec(exec, host, "systemctl --user restart openclaw-gateway");
    if (!restartResult.ok) {
      applySpinner.stop(`Failed to restart gateway on ${agentName}`);
      ui.log.warn(`  ${agentName}: ${restartResult.output}`);
      failed++;
      continue;
    }

    applied++;
  }

  if (applied > 0 && failed === 0) {
    applySpinner.stop(`Applied to ${applied} agent(s)`);
  } else if (applied > 0) {
    applySpinner.stop(`Applied to ${applied} agent(s), ${failed} failed`);
  } else {
    applySpinner.stop(`Failed to apply to any agents`);
  }

  if (failed > 0) {
    ui.log.warn(
      `Some agents could not be reached. They will pick up the secrets on next deploy.`
    );
  }

  ui.outro("Webhook setup complete!");
};
