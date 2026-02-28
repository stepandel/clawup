/**
 * Webhooks Setup Tool — Configure Linear webhooks for deployed agents
 *
 * Collects signing secrets, stores them in Pulumi config for persistence,
 * then applies them live via SSH (no redeploy needed).
 *
 * Platform-agnostic implementation using RuntimeAdapter.
 */

import type { RuntimeAdapter, ToolImplementation, ExecAdapter } from "../adapters";
import { requireResolvedManifest } from "../lib/config";
import { SSH_USER, tailscaleHostname, resolvePlugin } from "@clawup/core";
import type { IdentityManifest, PluginManifest } from "@clawup/core";
import { fetchIdentitySync } from "@clawup/core/identity";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { getConfig, getStackOutputs } from "../lib/tool-helpers";
import { qualifiedStackName } from "../lib/pulumi";
import pc from "picocolors";
import path from "path";
import os from "os";

export interface WebhooksSetupOptions {}

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

  ui.intro("Clawup — Webhook Setup");

  // Ensure workspace is set up
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

  // Select stack (use org-qualified name if organization is set)
  const pulumiStack = qualifiedStackName(manifest.stackName, manifest.organization);
  const selectResult = exec.capture("pulumi", ["stack", "select", pulumiStack], cwd);
  if (selectResult.exitCode !== 0) {
    ui.log.error(`Could not select Pulumi stack "${pulumiStack}". Run ${pc.cyan("clawup deploy")} first.`);
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

  // Check if any webhook URLs exist (keys are ${role}${PluginSlug}WebhookUrl)
  const agentsWithUrls = manifest.agents.filter(
    (agent) => Object.keys(outputs).some(
      (k) => k.startsWith(agent.role) && k.endsWith("WebhookUrl")
    )
  );

  if (agentsWithUrls.length === 0) {
    ui.log.error(
      "No webhook URLs found in stack outputs.\n" +
      `  Make sure agents are deployed and exposing webhook endpoints.\n` +
      `  Run ${pc.cyan("clawup deploy")} if you haven't already.`
    );
    process.exit(1);
  }

  // Find all plugins with webhookSetup across all agents
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const webhookPlugins: { agent: typeof manifest.agents[0]; plugin: PluginManifest }[] = [];

  for (const agent of manifest.agents) {
    try {
      const identity = fetchIdentitySync(agent.identity, identityCacheDir);
      for (const pluginName of identity.manifest.plugins ?? []) {
        const pluginManifest = resolvePlugin(pluginName, identity);
        if (pluginManifest.webhookSetup) {
          webhookPlugins.push({ agent, plugin: pluginManifest });
        }
      }
    } catch {
      ui.log.warn(`Could not load identity for ${agent.displayName} — skipping webhook checks.`);
    }
  }

  if (webhookPlugins.length === 0) {
    ui.log.warn("No plugins with webhook setup found.");
    ui.outro("Nothing to do.");
    return;
  }

  // Group by plugin for the intro message
  const pluginNames = [...new Set(webhookPlugins.map((wp) => wp.plugin.displayName))];
  ui.note(
    [
      `This will walk you through creating webhooks for: ${pluginNames.join(", ")}.`,
      "You'll need access to the relevant service settings.",
    ].join("\n"),
    "Webhook Setup"
  );

  // Collect webhook secrets for each agent/plugin pair
  const secrets: { role: string; name: string; agentName: string; secret: string; plugin: PluginManifest }[] = [];

  for (const { agent, plugin } of webhookPlugins) {
    const pluginSlug = plugin.name.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase());
    const webhookUrl = outputs[`${agent.role}${pluginSlug}WebhookUrl`] as string | undefined;
    if (!webhookUrl) {
      ui.log.warn(`No webhook URL found for ${agent.displayName} (${agent.role}) — skipping.`);
      continue;
    }

    const setup = plugin.webhookSetup!;
    ui.note(
      [
        `Webhook URL: ${pc.cyan(String(webhookUrl))}`,
        "",
        "Steps:",
        ...setup.instructions,
      ].join("\n"),
      `${agent.displayName} (${agent.role}) — ${plugin.displayName}`
    );

    const secret = await ui.text({
      message: `Signing secret for ${agent.displayName} (${plugin.displayName})`,
      placeholder: "Paste the signing secret",
      validate: (val: string) => {
        if (!val) return "Signing secret is required";
      },
    });

    secrets.push({
      role: agent.role,
      name: agent.name,
      agentName: agent.displayName,
      secret: secret as string,
      plugin,
    });
  }

  if (secrets.length === 0) {
    ui.log.warn("No webhook secrets collected.");
    ui.outro("Nothing to do.");
    return;
  }

  // Store secrets in Pulumi config (for persistence across deploys)
  const configSpinner = ui.spinner("Saving webhook secrets to Pulumi config...");
  for (const { role, secret, plugin } of secrets) {
    const secretKey = plugin.webhookSetup!.secretKey;
    // Derive Pulumi config key from the secret's envVar: e.g., <role>LinearWebhookSecret
    const secretDef = plugin.secrets[secretKey];
    const envVarSuffix = secretDef
      ? secretDef.envVar.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("")
      : secretKey.charAt(0).toUpperCase() + secretKey.slice(1);
    const pulumiKey = `${role}${envVarSuffix}`;
    exec.capture(
      "pulumi",
      ["config", "set", pulumiKey, secret, "--secret"],
      cwd
    );
  }
  configSpinner.stop(`Saved ${secrets.length} webhook secret(s) to Pulumi config`);

  // Apply secrets live via SSH
  const applySpinner = ui.spinner("Applying webhook secrets to running agents...");
  let applied = 0;
  let failed = 0;

  for (const { role, name, agentName, secret, plugin } of secrets) {
    const tsHost = tailscaleHostname(manifest.stackName, name);
    const host = `${tsHost}.${tailnetDnsName}`;

    // Use configJsonPath from plugin manifest to build the jq path
    const jsonPath = plugin.webhookSetup!.configJsonPath;
    const jqPath = "." + jsonPath.replace(/^\./, "");

    // Escape the secret for use inside jq
    const escapedSecret = secret.replace(/'/g, "'\\''");
    const jqCmd =
      `jq '${jqPath} = \\\"${escapedSecret.replace(/\\/g, "\\\\").replace(/"/g, '\\\\\\"')}\\\"' ` +
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
