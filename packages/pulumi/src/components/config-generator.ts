/**
 * OpenClaw configuration generator
 * Builds openclaw config set commands for cloud-init provisioning
 */

import { CODING_AGENT_REGISTRY, MODEL_PROVIDERS, getProviderForModel } from "@clawup/core";

/**
 * A single plugin entry for the OpenClaw config.
 * Used to dynamically generate `openclaw config set` commands for each plugin.
 */
export interface PluginEntry {
  /** Plugin package name (e.g., "openclaw-linear") */
  name: string;
  /** Whether the plugin is enabled */
  enabled: boolean;
  /** Non-secret config for this plugin */
  config: Record<string, unknown>;
  /**
   * Env var mappings for secrets: { configKey: envVarName }
   * e.g., { "apiKey": "LINEAR_API_KEY", "webhookSecret": "LINEAR_WEBHOOK_SECRET" }
   */
  secretEnvVars?: Record<string, string>;
  /** Where this plugin's config lives in openclaw.json: "plugins.entries" or "channels" */
  configPath?: "plugins.entries" | "channels";
  /** Keys that are clawup-internal metadata and should NOT be written to OpenClaw config */
  internalKeys?: string[];
  /** Config transforms to apply before writing (e.g., dm flattening for Slack) */
  configTransforms?: Array<{
    sourceKey: string;
    targetKeys: Record<string, string>;
    removeSource: boolean;
  }>;
}

/** Matches a string that is entirely an env var reference: $VAR_NAME */
const ENV_VAR_PATTERN = /^\$([A-Z][A-Z0-9_]*)$/;

/**
 * Convert a JS value to a JSON string suitable for `openclaw config set`.
 * Env var references ($VAR_NAME) become bash $VAR references.
 * Objects/arrays are JSON-stringified.
 */
function toJsonValue(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "string") {
    const envMatch = value.match(ENV_VAR_PATTERN);
    if (envMatch) {
      return `"$${envMatch[1]}"`;
    }
    return `'"${value.replace(/'/g, "'\\''")}"'`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  // Objects and arrays — JSON stringify, wrapping in single quotes for bash
  return `'${JSON.stringify(value).replace(/'/g, "'\\''")}'`;
}

export interface OpenClawConfigOptions {
  /** Gateway port (default: 18789) */
  gatewayPort?: number;
  /** Browser control port (default: 18791) */
  browserPort?: number;
  /** Gateway authentication token */
  gatewayToken: string;
  /** Default AI model (default: anthropic/claude-sonnet-4-5) */
  model?: string;
  /** Backup/fallback model (e.g., "anthropic/claude-sonnet-4-5") */
  backupModel?: string;
  /** Coding agent CLI name (e.g., "claude-code"). Defaults to "claude-code". */
  codingAgent?: string;
  /** Enable Docker sandbox (default: true) */
  enableSandbox?: boolean;
  /** Trusted proxy IPs for Tailscale Serve (default: ["127.0.0.1"]) */
  trustedProxies?: string[];
  /** Enable control UI (default: true) */
  enableControlUi?: boolean;
  /** Additional workspace files to inject */
  workspaceFiles?: Record<string, string>;
  /** Custom configuration overrides */
  customConfig?: Record<string, unknown>;
  /** Dynamic plugin configurations */
  plugins?: PluginEntry[];
  /** Brave Search API key for web search */
  braveApiKey?: string;
}

export interface OpenClawConfig {
  gateway: {
    port: number;
    mode?: string;
    trustedProxies: string[];
    controlUi: {
      enabled: boolean;
      allowInsecureAuth: boolean;
    };
    auth: {
      mode: string;
      token: string;
    };
  };
  browser?: {
    port: number;
  };
  model?: string;
  tools?: {
    web: {
      search: {
        provider: string;
        apiKey: string;
      };
    };
  };
  [key: string]: unknown;
}

/**
 * Generates an openclaw.json configuration object
 */
export function generateOpenClawConfig(options: OpenClawConfigOptions): OpenClawConfig {
  const config: OpenClawConfig = {
    gateway: {
      port: options.gatewayPort ?? 18789,
      mode: "local",
      trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
      controlUi: {
        enabled: options.enableControlUi ?? true,
        allowInsecureAuth: true,  // Safe behind Tailscale
      },
      auth: {
        mode: "token",
        token: options.gatewayToken,
      },
    },
  };

  if (options.browserPort) {
    config.browser = {
      port: options.browserPort,
    };
  }

  if (options.braveApiKey) {
    config.tools = { web: { search: { provider: "brave", apiKey: options.braveApiKey } } };
  }

  // Merge custom config
  if (options.customConfig) {
    Object.assign(config, options.customConfig);
  }

  return config;
}

/**
 * Generates openclaw.json as a JSON string
 */
export function generateOpenClawConfigJson(options: OpenClawConfigOptions): string {
  return JSON.stringify(generateOpenClawConfig(options), null, 2);
}

/**
 * Generates `openclaw config set` commands for a plugins.entries plugin.
 */
function generatePluginConfigSet(plugin: PluginEntry): string {
  if (plugin.configPath === "channels") {
    return generateChannelConfigSet(plugin);
  }

  const internalKeys = new Set(plugin.internalKeys ?? []);
  const lines: string[] = [];

  lines.push(`# Configure ${plugin.name} plugin`);
  lines.push(`openclaw config set 'plugins.entries.${plugin.name}.enabled' ${plugin.enabled ? "true" : "false"}`);

  // Secret env var values (skip internal keys)
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      if (internalKeys.has(configKey)) continue;
      lines.push(`openclaw config set 'plugins.entries.${plugin.name}.config.${configKey}' "$${envVar}"`);
    }
  }

  // Non-secret config values (filter out internal metadata)
  for (const [key, value] of Object.entries(plugin.config)) {
    if (internalKeys.has(key)) continue;
    lines.push(`openclaw config set 'plugins.entries.${plugin.name}.config.${key}' ${toJsonValue(value)}`);
  }

  lines.push(`echo "Configured ${plugin.name} plugin"`);

  return lines.join("\n");
}

/**
 * Generates `openclaw config set` commands for a channel-type plugin.
 * Preserves configTransforms support and internalKeys filtering.
 */
function generateChannelConfigSet(plugin: PluginEntry): string {
  const internalKeys = new Set(plugin.internalKeys ?? []);
  const transforms = plugin.configTransforms ?? [];
  const transformSourceKeys = new Set(transforms.map((t) => t.sourceKey));
  const lines: string[] = [];

  lines.push(`# Configure ${plugin.name} channel and plugin`);

  // Secret env var values (skip internal keys)
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      if (internalKeys.has(configKey)) continue;
      lines.push(`openclaw config set 'channels.${plugin.name}.${configKey}' "$${envVar}"`);
    }
  }

  // Non-secret config values with generic transform support
  for (const [key, value] of Object.entries(plugin.config)) {
    if (internalKeys.has(key)) continue;

    // Apply config transforms
    if (transformSourceKeys.has(key) && typeof value === "object" && value !== null) {
      const transform = transforms.find((t) => t.sourceKey === key)!;
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, targetKey] of Object.entries(transform.targetKeys)) {
        if (nested[nestedKey] !== undefined) {
          lines.push(`openclaw config set 'channels.${plugin.name}.${targetKey}' ${toJsonValue(nested[nestedKey])}`);
        }
      }
      // Only skip the source key if removeSource is true
      if (transform.removeSource) continue;
    }

    lines.push(`openclaw config set 'channels.${plugin.name}.${key}' ${toJsonValue(value)}`);
  }

  // Enable channel and plugin entry
  lines.push(`openclaw config set 'channels.${plugin.name}.enabled' true`);
  lines.push(`openclaw config set 'plugins.entries.${plugin.name}.enabled' ${plugin.enabled ? "true" : "false"}`);
  lines.push(`echo "Configured ${plugin.name} channel"`);

  return lines.join("\n");
}

/**
 * Generates a bash script using `openclaw config set` and `openclaw models set`
 * for modifying openclaw.json after onboarding.
 * Replaces the previous Python-based config patching approach.
 */
export function generateConfigPatchBash(options: OpenClawConfigOptions): string {
  const trustedProxies = options.trustedProxies ?? ["127.0.0.1"];
  const enableControlUi = options.enableControlUi ?? true;

  // Build model config (primary + optional fallbacks)
  const model = options.model ?? "anthropic/claude-opus-4-6";
  const backupModel = options.backupModel;
  const providerKey = getProviderForModel(model);
  const providerDef = MODEL_PROVIDERS[providerKey];
  if (providerKey !== "anthropic" && !providerDef) {
    throw new Error(`Unknown model provider "${providerKey}" from model "${model}". Supported: ${Object.keys(MODEL_PROVIDERS).join(", ")}`);
  }

  // Determine backup model provider (may differ from primary)
  const backupProviderKey = backupModel ? getProviderForModel(backupModel) : undefined;
  const backupProviderDef = backupProviderKey ? MODEL_PROVIDERS[backupProviderKey] : undefined;

  // Build cliBackends config from coding agent registry
  const codingAgentName = options.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];
  const cliBackendsJson = codingAgentEntry
    ? JSON.stringify({ "claude-cli": Object.fromEntries(
        Object.entries(codingAgentEntry.cliBackend).filter(([, v]) => v !== "" && v !== "never")
      ) })
    : "{}";

  // Build dynamic plugin config sections
  const pluginConfigs = (options.plugins ?? [])
    .map((plugin) => generatePluginConfigSet(plugin))
    .join("\n\n");

  // Check if slack plugin is present (for allowBots)
  const hasSlackPlugin = (options.plugins ?? []).some(
    (p) => p.name === "slack" && p.configPath === "channels"
  );

  const lines: string[] = [];

  // 1. Gateway token
  lines.push(`# Configure gateway auth token`);
  lines.push(`openclaw config set gateway.auth '{"mode":"token","token":"'"$GATEWAY_TOKEN"'"}'`);

  // 2. Trusted proxies
  lines.push(`# Configure trusted proxies`);
  lines.push(`openclaw config set gateway.trustedProxies '${JSON.stringify(trustedProxies)}'`);

  // 3. Control UI
  lines.push(`# Configure control UI`);
  lines.push(`openclaw config set gateway.controlUi '{"enabled":${enableControlUi},"allowInsecureAuth":true}'`);

  // 4. Provider env vars
  if (providerKey === "anthropic") {
    lines.push(`# Anthropic: auto-detect credential type (OAuth token vs API key)`);
    lines.push(`if [[ "$ANTHROPIC_API_KEY" == sk-ant-oat* ]]; then`);
    lines.push(`  # OAuth token from Claude Pro/Max subscription`);
    lines.push(`  openclaw config set env.CLAUDE_CODE_OAUTH_TOKEN "$ANTHROPIC_API_KEY"`);
    lines.push(`  echo "Configured environment variables: CLAUDE_CODE_OAUTH_TOKEN (OAuth/subscription)"`);
    lines.push(`else`);
    lines.push(`  # API key from Anthropic Console`);
    lines.push(`  openclaw config set env.ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"`);
    lines.push(`  echo "Configured environment variables: ANTHROPIC_API_KEY (API key)"`);
    lines.push(`fi`);
  } else {
    const envVar = providerDef?.envVar ?? "MODEL_API_KEY";
    lines.push(`# ${providerDef?.name ?? providerKey}: set provider API key env var`);
    lines.push(`openclaw config set env.${envVar} "$${envVar}"`);
    lines.push(`echo "Configured environment variables: ${envVar}"`);
  }

  // 5. Backup provider env (if different from primary)
  if (backupProviderKey && backupProviderKey !== providerKey && backupProviderDef) {
    lines.push(`# Backup model provider: ${backupProviderDef.name} — set ${backupProviderDef.envVar}`);
    lines.push(`if [ -n "$${backupProviderDef.envVar}" ]; then`);
    lines.push(`  openclaw config set env.${backupProviderDef.envVar} "$${backupProviderDef.envVar}"`);
    lines.push(`  echo "Configured backup provider env: ${backupProviderDef.envVar}"`);
    lines.push(`fi`);
  }

  // 6. Codex + OpenRouter aliasing
  if (codingAgentName === "codex" && providerKey === "openrouter") {
    lines.push(`# Codex uses OpenAI-compatible API — alias OpenRouter credentials`);
    lines.push(`openclaw config set env.OPENAI_API_KEY "$OPENROUTER_API_KEY"`);
    lines.push(`openclaw config set env.OPENAI_BASE_URL '"https://openrouter.ai/api/v1"'`);
    lines.push(`echo "Aliased OPENROUTER_API_KEY -> OPENAI_API_KEY + OPENAI_BASE_URL for Codex"`);
  }

  // 7. Heartbeat
  lines.push(`# Configure heartbeat (proactive mode)`);
  lines.push(`openclaw config set agents.defaults.heartbeat '{"every":"1m","session":"main"}'`);
  lines.push(`echo "Configured heartbeat: every 1m"`);

  // 8. Model
  if (backupModel) {
    lines.push(`# Configure model with fallbacks`);
    lines.push(`openclaw config set agents.defaults.model '{"primary":"${model}","fallbacks":["${backupModel}"]}'`);
    lines.push(`echo "Configured model: ${model} (fallback: ${backupModel})"`);
  } else {
    lines.push(`# Configure model`);
    lines.push(`openclaw models set "${model}"`);
    lines.push(`echo "Configured model: ${model}"`);
  }

  // 9. CLI backends
  lines.push(`# Configure coding agent CLI backend`);
  lines.push(`openclaw config set agents.defaults.cliBackends '${cliBackendsJson}'`);
  lines.push(`echo "Configured cliBackends for ${codingAgentName}"`);

  // 10. ACP default agent
  lines.push(`# Set default agent for ACP (coding agent) sessions`);
  lines.push(`openclaw config set acp.defaultAgent '"default"'`);
  lines.push(`echo "Configured acp.defaultAgent = default"`);

  // 11. Plugin configs
  if (pluginConfigs) {
    lines.push("");
    lines.push(pluginConfigs);
  }

  // 12. Agent identity
  lines.push(`# Configure agent identity for Slack mentions/tags`);
  lines.push(`if [ -n "$AGENT_NAME" ]; then`);
  lines.push(`  if [ -n "$AGENT_EMOJI" ]; then`);
  lines.push(`    openclaw config set agents.list '[{"id":"default","identity":{"name":"'"$AGENT_NAME"'","emoji":"'"$AGENT_EMOJI"'"}}]'`);
  lines.push(`  else`);
  lines.push(`    openclaw config set agents.list '[{"id":"default","identity":{"name":"'"$AGENT_NAME"'"}}]'`);
  lines.push(`  fi`);
  lines.push(`  echo "Configured agent identity: $AGENT_NAME (:$AGENT_EMOJI:)"`);

  // 13. Slack allowBots (emitted at generation time if Slack plugin present)
  if (hasSlackPlugin) {
    lines.push(`  # Enable allowBots so agents can see each other's messages in shared channels`);
    lines.push(`  openclaw config set channels.slack.allowBots true`);
    lines.push(`  echo "Enabled allowBots for Slack channel"`);
  }

  // 14. Ack reaction
  lines.push(`  # Add ack reaction for visual feedback when processing messages`);
  lines.push(`  openclaw config set messages.ackReaction '"eyes"'`);
  lines.push(`  echo "Configured ackReaction: eyes"`);
  lines.push(`fi`);

  // 15. Brave search
  lines.push(`# Configure web search (Brave API key) if available`);
  lines.push(`if [ -n "$BRAVE_API_KEY" ]; then`);
  lines.push(`  openclaw config set tools.web.search '{"provider":"brave","apiKey":"'"$BRAVE_API_KEY"'"}'`);
  lines.push(`  echo "Configured web search with Brave API key"`);
  lines.push(`fi`);

  lines.push(`echo "Configuration complete"`);

  return lines.join("\n");
}
