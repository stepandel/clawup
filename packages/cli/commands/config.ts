/**
 * clawup config — View and modify config without re-running init
 *
 * Subcommands:
 *   show  — Display current config
 *   set   — Update a config value
 */

import * as process from "process";
import YAML from "yaml";
import {
  requireManifest,
  requireResolvedManifest,
  saveManifest,
} from "../lib/config";
import {
  AWS_REGIONS,
  HETZNER_LOCATIONS,
  INSTANCE_TYPES,
  HETZNER_SERVER_TYPES_EU,
  HETZNER_SERVER_TYPES_US,
  hetznerServerTypes,
} from "@clawup/core";
import type { ClawupManifest } from "@clawup/core";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Top-level manifest keys that can be set */
const SETTABLE_TOP_KEYS = [
  "region",
  "instanceType",
  "ownerName",
  "timezone",
  "workingHours",
  "userNotes",
] as const;

type SettableTopKey = (typeof SETTABLE_TOP_KEYS)[number];

/** Per-agent keys that can be set */
const SETTABLE_AGENT_KEYS = [
  "instanceType",
  "volumeSize",
  "displayName",
] as const;

type SettableAgentKey = (typeof SETTABLE_AGENT_KEYS)[number];

function isSettableTopKey(key: string): key is SettableTopKey {
  return (SETTABLE_TOP_KEYS as readonly string[]).includes(key);
}

function isSettableAgentKey(key: string): key is SettableAgentKey {
  return (SETTABLE_AGENT_KEYS as readonly string[]).includes(key);
}

function allRegionValues(provider: string): string[] {
  if (provider === "hetzner") return HETZNER_LOCATIONS.map((r) => r.value);
  return AWS_REGIONS.map((r) => r.value);
}

function allInstanceTypeValues(provider: string, region?: string): string[] {
  if (provider === "hetzner") {
    const types = region ? hetznerServerTypes(region) : [...HETZNER_SERVER_TYPES_EU, ...HETZNER_SERVER_TYPES_US];
    return types.map((t) => t.value);
  }
  return INSTANCE_TYPES.map((t) => t.value);
}

function validateTopValue(
  manifest: ClawupManifest,
  key: SettableTopKey,
  value: string
): string | null {
  const provider = manifest.provider ?? "aws";

  if (key === "region") {
    const valid = allRegionValues(provider);
    if (!valid.includes(value)) {
      return `Invalid region '${value}' for provider '${provider}'. Valid options:\n  ${valid.join("\n  ")}`;
    }
    // Cross-validate: check if current instanceType is valid for the new region
    if (provider === "hetzner" && manifest.instanceType) {
      const validTypes = allInstanceTypeValues(provider, value);
      if (!validTypes.includes(manifest.instanceType)) {
        return `Region '${value}' is not compatible with current instanceType '${manifest.instanceType}'.\nUpdate instanceType first, or set both:\n  clawup config set instanceType <type>\n  clawup config set region ${value}`;
      }
    }
  }

  if (key === "instanceType") {
    const valid = allInstanceTypeValues(provider, manifest.region);
    if (!valid.includes(value)) {
      return `Invalid instanceType '${value}' for provider '${provider}'. Valid options:\n  ${valid.join("\n  ")}`;
    }
  }

  return null;
}

function validateAgentValue(
  manifest: ClawupManifest,
  key: SettableAgentKey,
  value: string
): string | null {
  if (key === "instanceType") {
    const provider = manifest.provider ?? "aws";
    const valid = allInstanceTypeValues(provider, manifest.region);
    if (!valid.includes(value)) {
      return `Invalid instanceType '${value}' for provider '${provider}'. Valid options:\n  ${valid.join("\n  ")}`;
    }
  }

  if (key === "volumeSize") {
    const num = Number(value);
    if (isNaN(num) || num < 8 || num > 1000) {
      return `volumeSize must be a number between 8 and 1000 (GB). Got: '${value}'`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

export interface ConfigShowOptions {
  json?: boolean;
}

export async function configShowCommand(opts: ConfigShowOptions): Promise<void> {
  let manifest;
  try {
    manifest = requireResolvedManifest();
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exit(1);
  }

  if (opts.json) {
    console.log(YAML.stringify(manifest).trimEnd());
    return;
  }

  // Human-readable output
  console.log();
  console.log(pc.bold(`Config: ${manifest.stackName}`));
  console.log();
  console.log(`  Stack:          ${manifest.stackName}`);
  console.log(`  Provider:       ${manifest.provider ?? "aws"}`);
  console.log(`  Region:         ${manifest.region}`);
  console.log(`  Instance Type:  ${manifest.instanceType}`);
  console.log(`  Owner:          ${manifest.ownerName}`);
  if (manifest.timezone) console.log(`  Timezone:       ${manifest.timezone}`);
  if (manifest.workingHours) console.log(`  Working Hours:  ${manifest.workingHours}`);
  if (manifest.userNotes) console.log(`  User Notes:     ${manifest.userNotes}`);

  if (manifest.templateVars && Object.keys(manifest.templateVars).length > 0) {
    console.log();
    console.log(pc.bold("Template Variables:"));
    for (const [key, value] of Object.entries(manifest.templateVars)) {
      console.log(`  ${key}: ${value}`);
    }
  }

  console.log();
  console.log(pc.bold(`Agents (${manifest.agents.length}):`));
  for (const agent of manifest.agents) {
    const override = agent.instanceType ? ` [${agent.instanceType}]` : "";
    console.log(`  ${pc.bold(agent.displayName)} (${agent.role}) vol:${agent.volumeSize}GB${override}`);
    console.log(`    identity: ${agent.identity}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

export interface ConfigSetOptions {
  agent?: string;
}

export async function configSetCommand(
  key: string,
  value: string,
  opts: ConfigSetOptions
): Promise<void> {
  let manifest: ClawupManifest;
  try {
    manifest = requireManifest();
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exit(1);
  }

  // Resolve agents to get name/displayName/role for lookup
  let resolved;
  try {
    resolved = requireResolvedManifest();
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exit(1);
  }

  if (opts.agent) {
    // Per-agent set
    if (!isSettableAgentKey(key)) {
      console.error(pc.red(`Invalid per-agent key '${key}'. Valid keys:\n  ${SETTABLE_AGENT_KEYS.join("\n  ")}`));
      process.exit(1);
    }

    // Find agent index in resolved manifest, then apply change to raw manifest
    const resolvedIdx = resolved.agents.findIndex(
      (a) => a.name === opts.agent || a.displayName.toLowerCase() === opts.agent!.toLowerCase() || a.role === opts.agent
    );
    if (resolvedIdx === -1) {
      const names = resolved.agents.map((a) => `${a.displayName} (${a.role})`).join(", ");
      console.error(pc.red(`Agent '${opts.agent}' not found. Available: ${names}`));
      process.exit(1);
    }
    const agent = manifest.agents[resolvedIdx];
    const resolvedAgent = resolved.agents[resolvedIdx];

    const err = validateAgentValue(manifest, key, value);
    if (err) {
      console.error(pc.red(err));
      process.exit(1);
    }

    const agentRec = agent as unknown as Record<string, unknown>;
    const oldValue = agentRec[key];
    if (key === "volumeSize") {
      agent.volumeSize = Number(value);
    } else {
      agentRec[key] = value;
    }

    saveManifest(manifest);
    console.log(
      pc.green(`✓ ${resolvedAgent.displayName}.${key}: ${String(oldValue ?? "(unset)")} → ${value}`)
    );
  } else if (key.startsWith("templateVars.")) {
    // templateVars.KEY set
    const varName = key.slice("templateVars.".length);
    if (!varName) {
      console.error(pc.red("Template variable name cannot be empty. Use: templateVars.KEY"));
      process.exit(1);
    }

    if (!manifest.templateVars) manifest.templateVars = {};
    const oldValue = manifest.templateVars[varName];
    manifest.templateVars[varName] = value;

    saveManifest(manifest);
    console.log(pc.green(`✓ templateVars.${varName}: ${String(oldValue ?? "(unset)")} → ${value}`));
  } else {
    // Top-level set
    if (!isSettableTopKey(key)) {
      console.error(pc.red(`Invalid key '${key}'. Valid keys:\n  ${SETTABLE_TOP_KEYS.join("\n  ")}\n  templateVars.<KEY>`));
      process.exit(1);
    }

    const err = validateTopValue(manifest, key, value);
    if (err) {
      console.error(pc.red(err));
      process.exit(1);
    }

    const manifestRec = manifest as unknown as Record<string, unknown>;
    const oldValue = manifestRec[key];
    manifestRec[key] = value;

    saveManifest(manifest);
    console.log(pc.green(`✓ ${key}: ${String(oldValue ?? "(unset)")} → ${value}`));
  }

  console.log(pc.dim("\nRun 'clawup redeploy' or 'clawup destroy && clawup deploy' to apply changes."));
}
