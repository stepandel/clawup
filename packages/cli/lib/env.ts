/**
 * .env file parser, ${env:VAR} resolver, and secret loader.
 *
 * Follows the Serverless Framework V4 pattern: the clawup.yaml manifest declares
 * which env vars to read using ${env:VAR_NAME} syntax. Values are loaded from a
 * .env file (or process.env) and resolved at init time.
 */

import * as fs from "fs";
import { resolvePlugin, PLUGIN_MANIFEST_REGISTRY, MODEL_PROVIDERS, getRequiredProviders, getProviderConfigKey, getProviderEnvVar } from "@clawup/core";

// ---------------------------------------------------------------------------
// Validators — shared prefix/suffix checks for well-known secret types
// ---------------------------------------------------------------------------

/** Infrastructure validators — always present regardless of plugins */
export const VALIDATORS: Record<string, (val: string) => string | undefined> = {
  // Per-provider API key validators (generated from MODEL_PROVIDERS)
  ...Object.fromEntries(
    Object.entries(MODEL_PROVIDERS)
      .filter(([, def]) => def.keyPrefix)
      .map(([key, def]) => {
        const configKey = getProviderConfigKey(key);
        return [configKey, (val: string) => {
          if (!val.startsWith(def.keyPrefix)) return `Must start with ${def.keyPrefix}`;
        }];
      })
  ),
  tailscaleAuthKey: (val) => {
    if (!val.startsWith("tskey-auth-")) return "Must start with tskey-auth-";
  },
  tailnetDnsName: (val) => {
    if (!val.endsWith(".ts.net")) return "Must end with .ts.net";
  },
  githubToken: (val) => {
    if (!val.startsWith("ghp_") && !val.startsWith("github_pat_")) {
      return "Must start with ghp_ or github_pat_";
    }
  },
};

// ---------------------------------------------------------------------------
// .env file parser
// ---------------------------------------------------------------------------

/**
 * Parse a .env file into a key-value map.
 * Supports KEY=value, # comments, empty lines, and quoted values ("..." / '...').
 * Returns an empty record if the file doesn't exist.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// ${env:VAR} resolver
// ---------------------------------------------------------------------------

const ENV_REF_RE = /^\$\{env:([^}]+)\}$/;

/**
 * Resolve a single `${env:VAR_NAME}` reference against an env dict.
 * - If the string is a `${env:...}` reference, extracts the var name and looks it up.
 * - If it's a plain string (no `${env:}` wrapper), returns it as-is (backwards compat).
 * - Returns undefined only when the reference can't be resolved.
 */
export function resolveEnvRef(
  ref: string,
  env: Record<string, string>,
): string | undefined {
  const match = ref.match(ENV_REF_RE);
  if (!match) {
    // Plain string — return as-is
    return ref;
  }
  const varName = match[1];
  return env[varName];
}

/**
 * Extract the env var name from a `${env:VAR_NAME}` reference.
 * Returns undefined if the string is not an env ref.
 */
export function extractEnvVarName(ref: string): string | undefined {
  const match = ref.match(ENV_REF_RE);
  return match ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Secret loader
// ---------------------------------------------------------------------------

export interface MissingSecret {
  key: string;
  envVar: string;
  agent?: string;
}

export interface ResolvedSecrets {
  /** Resolved global secrets */
  global: Record<string, string>;
  /** Per-agent resolved secrets: agentName → { key → value } */
  perAgent: Record<string, Record<string, string>>;
  /** Unresolved references */
  missing: MissingSecret[];
}

/**
 * Resolve all `${env:VAR}` references in the manifest secrets and per-agent secrets.
 *
 * @param manifestSecrets - The top-level `secrets` map from clawup.yaml
 * @param agents - Array of agents with optional `secrets` maps
 * @param env - Merged env dict (process.env + .env file)
 */
export function loadEnvSecrets(
  manifestSecrets: Record<string, string> | undefined,
  agents: Array<{ name: string; secrets?: Record<string, string> }>,
  env: Record<string, string>,
): ResolvedSecrets {
  const global: Record<string, string> = {};
  const perAgent: Record<string, Record<string, string>> = {};
  const missing: MissingSecret[] = [];

  // Resolve global secrets
  if (manifestSecrets) {
    for (const [key, ref] of Object.entries(manifestSecrets)) {
      const resolved = resolveEnvRef(ref, env);
      if (resolved !== undefined) {
        global[key] = resolved;
      } else {
        const envVar = extractEnvVarName(ref);
        missing.push({ key, envVar: envVar ?? ref });
      }
    }
  }

  // Resolve per-agent secrets
  for (const agent of agents) {
    if (!agent.secrets) continue;
    perAgent[agent.name] = {};
    for (const [key, ref] of Object.entries(agent.secrets)) {
      const resolved = resolveEnvRef(ref, env);
      if (resolved !== undefined) {
        perAgent[agent.name][key] = resolved;
      } else {
        const envVar = extractEnvVarName(ref);
        missing.push({ key, envVar: envVar ?? ref, agent: agent.name });
      }
    }
  }

  return { global, perAgent, missing };
}

// ---------------------------------------------------------------------------
// Env dict builder
// ---------------------------------------------------------------------------

/**
 * Build a merged env dict from a .env file and process.env.
 * process.env values take precedence (standard dotenv behavior).
 */
export function buildEnvDict(envFilePath: string): Record<string, string> {
  const fileEnv = parseEnvFile(envFilePath);
  // process.env values override .env file values
  const merged: Record<string, string> = { ...fileEnv };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Well-known env var name mappings
// ---------------------------------------------------------------------------

/** Standard env var names used when no manifest secrets section exists yet. */
export const WELL_KNOWN_ENV_VARS: Record<string, string> = {
  anthropicApiKey: "ANTHROPIC_API_KEY",
  tailscaleAuthKey: "TAILSCALE_AUTH_KEY",
  tailnetDnsName: "TAILNET_DNS_NAME",
  tailscaleApiKey: "TAILSCALE_API_KEY",
  hcloudToken: "HCLOUD_TOKEN",
  braveApiKey: "BRAVE_API_KEY",
};

/** Per-agent env var name pattern: <ROLE_UPPER>_<SUFFIX> */
export function agentEnvVarName(role: string, suffix: string): string {
  return `${role.toUpperCase()}_${suffix}`;
}

// ---------------------------------------------------------------------------
// camelCase → SCREAMING_SNAKE_CASE converter
// ---------------------------------------------------------------------------

/**
 * Convert a SCREAMING_SNAKE_CASE env var to camelCase.
 * e.g., "SLACK_BOT_TOKEN" → "slackBotToken", "LINEAR_API_KEY" → "linearApiKey"
 */
export function envVarToCamelCase(envVar: string): string {
  return envVar
    .toLowerCase()
    .split("_")
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Convert a camelCase key to SCREAMING_SNAKE_CASE.
 * e.g., "notionApiKey" → "NOTION_API_KEY", "slackBotToken" → "SLACK_BOT_TOKEN"
 */
export function camelToScreamingSnake(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Secrets section builder (for generating manifest secrets from identity data)
// ---------------------------------------------------------------------------

interface SecretsBuilderOpts {
  provider: string;
  agents: Array<{
    name: string;
    role: string;
    displayName: string;
    requiredSecrets?: string[];
  }>;
  allPluginNames: Set<string>;
  allDepNames: Set<string>;
  agentPlugins: Map<string, Set<string>>;
  agentDeps: Map<string, Set<string>>;
  /** All model strings across all agents (primary + backup). Used to determine required provider API keys. */
  allModels: string[];
}

export interface ManifestSecrets {
  global: Record<string, string>;
  perAgent: Record<string, Record<string, string>>;
}

/**
 * Build the `secrets` section for the manifest based on selected agents/plugins/deps.
 * Returns env var references like `${env:ANTHROPIC_API_KEY}`.
 */
export function buildManifestSecrets(opts: SecretsBuilderOpts): ManifestSecrets {
  const global: Record<string, string> = {};
  const perAgent: Record<string, Record<string, string>> = {};

  // Per-provider API keys — only require keys for providers actually used
  const requiredProviders = getRequiredProviders(opts.allModels);
  for (const providerKey of requiredProviders) {
    const configKey = getProviderConfigKey(providerKey);
    const envVar = getProviderEnvVar(providerKey);
    global[configKey] = `\${env:${envVar}}`;
  }

  if (opts.provider !== "local") {
    global.tailscaleAuthKey = "${env:TAILSCALE_AUTH_KEY}";
    global.tailnetDnsName = "${env:TAILNET_DNS_NAME}";

    // Optional global
    global.tailscaleApiKey = "${env:TAILSCALE_API_KEY}";
  }

  if (opts.provider === "hetzner") {
    global.hcloudToken = "${env:HCLOUD_TOKEN}";
  }

  if (opts.allDepNames.has("brave-search")) {
    global.braveApiKey = "${env:BRAVE_API_KEY}";
  }

  // Per-agent secrets — generic loop over resolved plugin manifests
  for (const agent of opts.agents) {
    const roleUpper = agent.role.toUpperCase();
    const agentSecrets: Record<string, string> = {};

    const plugins = opts.agentPlugins.get(agent.name);
    const deps = opts.agentDeps.get(agent.name);

    // Plugin secrets (driven by manifest metadata)
    if (plugins) {
      for (const pluginName of plugins) {
        const manifest = resolvePlugin(pluginName);
        for (const [key, secret] of Object.entries(manifest.secrets)) {
          if (secret.scope === "agent") {
            // Use the envVar to derive the manifest key (e.g., SLACK_BOT_TOKEN → slackBotToken)
            const manifestKey = envVarToCamelCase(secret.envVar);
            agentSecrets[manifestKey] = `\${env:${roleUpper}_${secret.envVar}}`;
          }
        }
      }
    }

    // Dep secrets
    if (deps?.has("gh")) {
      agentSecrets.githubToken = `\${env:${roleUpper}_GITHUB_TOKEN}`;
    }

    // Add requiredSecrets from identity manifest (additive, skip duplicates)
    if (agent.requiredSecrets) {
      for (const key of agent.requiredSecrets) {
        if (!agentSecrets[key]) {
          agentSecrets[key] = `\${env:${roleUpper}_${camelToScreamingSnake(key)}}`;
        }
      }
    }

    if (Object.keys(agentSecrets).length > 0) {
      perAgent[agent.name] = agentSecrets;
    }
  }

  return { global, perAgent };
}

// ---------------------------------------------------------------------------
// .env.example generator
// ---------------------------------------------------------------------------

interface EnvExampleOpts {
  globalSecrets: Record<string, string>;
  agents: Array<{ name: string; displayName: string; role: string }>;
  perAgentSecrets: Record<string, Record<string, string>>;
  /** Optional map of agent name → plugin names, to scope auto-resolvable checks */
  agentPluginNames?: Map<string, Set<string>>;
}

/**
 * Generate the contents of a .env.example file from the manifest secrets section.
 */
export function generateEnvExample(opts: EnvExampleOpts): string {
  const lines: string[] = [
    "# Clawup Secrets — copy to .env and fill in values",
    "# See clawup.yaml 'secrets' section for which keys map where",
    "",
  ];

  // Extract global env var names
  const globalVarNames: string[] = [];
  for (const ref of Object.values(opts.globalSecrets)) {
    const varName = extractEnvVarName(ref);
    if (varName) globalVarNames.push(varName);
  }

  if (globalVarNames.length > 0) {
    lines.push("# ── Required ─────────────────────────────────");
    for (const varName of globalVarNames) {
      lines.push(`${varName}=`);
    }
  }

  // Per-agent env var names
  for (const agent of opts.agents) {
    const agentSecrets = opts.perAgentSecrets[agent.name];
    if (!agentSecrets || Object.keys(agentSecrets).length === 0) continue;

    lines.push("");
    lines.push(`# ── Agent: ${agent.displayName} (${agent.role}) ──────────────────────`);
    for (const [key, ref] of Object.entries(agentSecrets)) {
      const varName = extractEnvVarName(ref);
      if (!varName) continue;

      // Check if this secret is auto-resolvable via plugin manifest
      // Scope to agent's actual plugins if available, otherwise check all
      // Note: `key` is envVar-derived camelCase (e.g., "linearApiKey") but manifest
      // secrets are keyed by raw name (e.g., "apiKey"). Match via envVar instead.
      let isAutoResolvable = false;
      const pluginNames = opts.agentPluginNames?.get(agent.name);
      const manifestsToCheck = pluginNames
        ? [...pluginNames].map((n) => PLUGIN_MANIFEST_REGISTRY[n]).filter(Boolean)
        : Object.values(PLUGIN_MANIFEST_REGISTRY);
      for (const pm of manifestsToCheck) {
        const matchingSecret = Object.values(pm.secrets).find(
          (s) => envVarToCamelCase(s.envVar) === key
        );
        if (matchingSecret?.autoResolvable) {
          isAutoResolvable = true;
          break;
        }
      }

      if (isAutoResolvable) {
        lines.push(`# ${varName}=  # auto-resolved by \`clawup setup\``);
      } else {
        lines.push(`${varName}=`);
      }
    }
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}
