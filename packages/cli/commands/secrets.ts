/**
 * clawup secrets — View and update Pulumi secrets without re-running init
 *
 * Subcommands:
 *   set   — Set a secret value (e.g. braveApiKey, anthropicApiKey)
 *   list  — Show which secrets are configured (values redacted)
 */

import * as process from "process";
import { requireManifest } from "../lib/config";
import { selectOrCreateStack, setConfig, getConfig } from "../lib/pulumi";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { PLUGIN_MANIFEST_REGISTRY, buildKnownSecrets, DEP_REGISTRY } from "@clawup/core";
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

/** Build the full KNOWN_SECRETS map: infrastructure + plugins + deps */
function buildAllKnownSecrets(): Record<string, SecretMeta> {
  // Infrastructure secrets (always present)
  const infra: Record<string, SecretMeta> = {
    anthropicApiKey: { label: "Anthropic API Key", perAgent: false, isSecret: true },
    tailscaleAuthKey: { label: "Tailscale Auth Key", perAgent: false, isSecret: true },
    tailscaleApiKey: { label: "Tailscale API Key", perAgent: false, isSecret: true },
    tailnetDnsName: { label: "Tailnet DNS Name", perAgent: false, isSecret: false },
  };

  // Plugin secrets (dynamic from registry)
  const pluginSecrets = buildKnownSecrets(Object.values(PLUGIN_MANIFEST_REGISTRY));

  // Dep secrets (dynamic from dep registry)
  const depSecrets: Record<string, SecretMeta> = {};
  for (const dep of Object.values(DEP_REGISTRY)) {
    for (const [key, secret] of Object.entries(dep.secrets)) {
      // Convert PascalCase key to camelCase for consistency
      const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
      depSecrets[camelKey] = {
        label: `${dep.displayName} ${key.replace(/([A-Z])/g, " $1").trim()}`,
        perAgent: secret.scope === "agent",
        isSecret: true,
      };
    }
  }

  return { ...infra, ...pluginSecrets, ...depSecrets };
}

const KNOWN_SECRETS: Record<string, SecretMeta> = buildAllKnownSecrets();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveStackAndCwd(): { stackName: string; cwd: string | undefined } {
  const manifest = requireManifest();

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
  agent?: string;
}

export async function secretsSetCommand(
  key: string,
  value: string,
  opts: SecretsSetOptions
): Promise<void> {
  let manifest;
  try {
    manifest = requireManifest();
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

  const { cwd } = resolveStackAndCwd();

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

export interface SecretsListOptions {}

export async function secretsListCommand(opts: SecretsListOptions): Promise<void> {
  let manifest;
  try {
    manifest = requireManifest();
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exit(1);
  }

  const { cwd } = resolveStackAndCwd();
  const roles = manifest.agents.map((a) => a.role);

  console.log();
  console.log(pc.bold(`Secrets for ${manifest.stackName}:`));
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
