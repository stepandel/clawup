/**
 * clawup secrets — View and update Pulumi secrets without re-running init
 *
 * Subcommands:
 *   set   — Set a secret value (e.g. braveApiKey, anthropicApiKey)
 *   list  — Show which secrets are configured (values redacted)
 */

import * as process from "process";
import { resolveConfigName, loadManifest } from "../lib/config";
import { selectOrCreateStack, setConfig, getConfig } from "../lib/pulumi";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// Known secrets and their metadata
// ---------------------------------------------------------------------------

interface SecretMeta {
  /** Human-readable label */
  label: string;
  /** Whether this is a per-agent secret (prefixed with role) */
  perAgent: boolean;
  /** Whether the value is stored as a Pulumi secret (encrypted) */
  isSecret: boolean;
}

const KNOWN_SECRETS: Record<string, SecretMeta> = {
  anthropicApiKey: { label: "Anthropic API Key", perAgent: false, isSecret: true },
  tailscaleAuthKey: { label: "Tailscale Auth Key", perAgent: false, isSecret: true },
  tailscaleApiKey: { label: "Tailscale API Key", perAgent: false, isSecret: true },
  tailnetDnsName: { label: "Tailnet DNS Name", perAgent: false, isSecret: false },
  braveApiKey: { label: "Brave Search API Key", perAgent: false, isSecret: true },
  slackBotToken: { label: "Slack Bot Token", perAgent: true, isSecret: true },
  slackAppToken: { label: "Slack App Token", perAgent: true, isSecret: true },
  linearApiKey: { label: "Linear API Key", perAgent: true, isSecret: true },
  linearWebhookSecret: { label: "Linear Webhook Secret", perAgent: true, isSecret: true },
  linearUserUuid: { label: "Linear User UUID", perAgent: true, isSecret: false },
  githubToken: { label: "GitHub Token", perAgent: true, isSecret: true },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveStackAndCwd(configName: string): { stackName: string; cwd: string | undefined } {
  const manifest = loadManifest(configName);
  if (!manifest) {
    console.error(pc.red(`Config '${configName}' could not be loaded.`));
    process.exit(1);
  }

  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    console.error(pc.red(wsResult.error ?? "Failed to set up workspace."));
    process.exit(1);
  }
  const cwd = getWorkspaceDir();

  const stackResult = selectOrCreateStack(manifest.stackName, cwd);
  if (!stackResult.ok) {
    console.error(pc.red(`Could not select Pulumi stack "${manifest.stackName}": ${stackResult.error}`));
    process.exit(1);
  }

  return { stackName: manifest.stackName, cwd };
}

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

export interface SecretsSetOptions {
  config?: string;
  agent?: string;
}

export async function secretsSetCommand(
  key: string,
  value: string,
  opts: SecretsSetOptions
): Promise<void> {
  let configName: string;
  try {
    configName = resolveConfigName(opts.config);
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exit(1);
  }

  // Resolve the actual Pulumi config key
  const meta = KNOWN_SECRETS[key];
  if (!meta) {
    const validKeys = Object.entries(KNOWN_SECRETS)
      .map(([k, m]) => `  ${k}${m.perAgent ? " (per-agent: use --agent)" : ""}`)
      .join("\n");
    console.error(pc.red(`Unknown secret '${key}'. Valid keys:\n${validKeys}`));
    process.exit(1);
  }

  let pulumiKey = key;
  if (meta.perAgent) {
    if (!opts.agent) {
      console.error(pc.red(`'${key}' is a per-agent secret. Use --agent <role> to specify which agent.`));
      process.exit(1);
    }
    pulumiKey = `${opts.agent}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  }

  const { cwd } = resolveStackAndCwd(configName);

  const ok = setConfig(pulumiKey, value, meta.isSecret, cwd);
  if (!ok) {
    console.error(pc.red(`Failed to set '${pulumiKey}' in Pulumi config.`));
    process.exit(1);
  }

  const maskedValue = meta.isSecret
    ? value.slice(0, 4) + "..." + value.slice(-4)
    : value;

  console.log(pc.green(`✓ ${pulumiKey}: set to ${maskedValue}`));
  console.log(pc.dim("\nRun 'clawup deploy' or 'clawup redeploy' to apply changes."));
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface SecretsListOptions {
  config?: string;
}

export async function secretsListCommand(opts: SecretsListOptions): Promise<void> {
  let configName: string;
  try {
    configName = resolveConfigName(opts.config);
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exit(1);
  }

  const manifest = loadManifest(configName);
  if (!manifest) {
    console.error(pc.red(`Config '${configName}' could not be loaded.`));
    process.exit(1);
  }

  const { cwd } = resolveStackAndCwd(configName);
  const roles = manifest.agents.map((a) => a.role);

  console.log();
  console.log(pc.bold(`Secrets for ${configName}:`));
  console.log();

  // Global secrets
  for (const [key, meta] of Object.entries(KNOWN_SECRETS)) {
    if (meta.perAgent) continue;

    const val = getConfig(key, cwd);
    const status = val ? pc.green("✓ set") : pc.dim("✗ not set");
    console.log(`  ${meta.label.padEnd(24)} ${status}`);
  }

  // Per-agent secrets
  const perAgentKeys = Object.entries(KNOWN_SECRETS).filter(([, m]) => m.perAgent);
  if (perAgentKeys.length > 0) {
    for (const role of roles) {
      console.log();
      console.log(pc.bold(`  ${role}:`));
      for (const [key, meta] of perAgentKeys) {
        const pulumiKey = `${role}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        const val = getConfig(pulumiKey, cwd);
        const status = val ? pc.green("✓ set") : pc.dim("✗ not set");
        console.log(`    ${meta.label.padEnd(24)} ${status}`);
      }
    }
  }

  console.log();
}
