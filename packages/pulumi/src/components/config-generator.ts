/**
 * OpenClaw configuration generator
 * Builds the complete openclaw.json configuration as a TypeScript object.
 *
 * Replaces the previous Python config-patching approach with direct JSON generation.
 * All secrets are resolved at Pulumi apply time and embedded directly in the config.
 */

import { CODING_AGENT_REGISTRY, MODEL_PROVIDERS, getProviderForModel } from "@clawup/core";

/**
 * A single plugin entry for the OpenClaw config.
 * Used to build the plugins/channels sections of openclaw.json.
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

/**
 * Options for generating the complete openclaw.json.
 * All secrets should be pre-resolved (concrete strings, not Pulumi Outputs).
 */
export interface FullOpenClawConfigOptions {
  /** Gateway port (default: 18789) */
  gatewayPort?: number;
  /** Gateway authentication token (resolved) */
  gatewayToken: string;
  /** AI model string (e.g., "anthropic/claude-opus-4-6") */
  model?: string;
  /** Backup/fallback model (e.g., "anthropic/claude-sonnet-4-5") */
  backupModel?: string;
  /** Coding agent CLI name (e.g., "claude-code", "codex") */
  codingAgent?: string;
  /** Trusted proxy IPs for Tailscale Serve (default: ["127.0.0.1"]) */
  trustedProxies?: string[];
  /** Enable control UI (default: true) */
  enableControlUi?: boolean;
  /** Dynamic plugin configurations */
  plugins?: PluginEntry[];
  /** Brave Search API key (resolved, or empty string) */
  braveApiKey?: string;
  /** Agent display name (for identity in agents.list) */
  agentName?: string;
  /** Agent emoji (for identity in agents.list) */
  agentEmoji?: string;
  /**
   * Pre-resolved provider environment variables.
   * OAuth detection should already be done upstream.
   * e.g., { "ANTHROPIC_API_KEY": "sk-ant-..." } or { "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat..." }
   */
  providerEnv: Record<string, string>;
  /**
   * Pre-resolved secret values for plugin env vars.
   * e.g., { "LINEAR_API_KEY": "lin_api_...", "SLACK_BOT_TOKEN": "xoxb-..." }
   */
  resolvedSecrets?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Plugin config builders (replaces Python generators)
// ---------------------------------------------------------------------------

/**
 * Build the config object for a plugins.entries plugin.
 * Filters internalKeys and resolves secret env vars to concrete values.
 */
function buildPluginEntryConfig(
  plugin: PluginEntry,
  resolvedSecrets: Record<string, string>,
): Record<string, unknown> {
  const internalKeys = new Set(plugin.internalKeys ?? []);
  const pluginConfig: Record<string, unknown> = {};

  // Secret values (resolve env var names to actual values)
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      if (internalKeys.has(configKey)) continue;
      pluginConfig[configKey] = resolvedSecrets[envVar] ?? "";
    }
  }

  // Non-secret config values
  for (const [key, value] of Object.entries(plugin.config)) {
    if (internalKeys.has(key)) continue;
    pluginConfig[key] = value;
  }

  return pluginConfig;
}

/**
 * Build the config object for a channel plugin (e.g., Slack).
 * Applies configTransforms, filters internalKeys, resolves secrets.
 */
function buildChannelConfig(
  plugin: PluginEntry,
  resolvedSecrets: Record<string, string>,
): Record<string, unknown> {
  const internalKeys = new Set(plugin.internalKeys ?? []);
  const transforms = plugin.configTransforms ?? [];
  const transformSourceKeys = new Set(transforms.map((t) => t.sourceKey));
  const channelConfig: Record<string, unknown> = {};

  // Secret values
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      if (internalKeys.has(configKey)) continue;
      channelConfig[configKey] = resolvedSecrets[envVar] ?? "";
    }
  }

  // Non-secret config with transform support
  for (const [key, value] of Object.entries(plugin.config)) {
    if (internalKeys.has(key)) continue;

    // Apply config transforms (e.g., Slack dm flattening)
    if (transformSourceKeys.has(key) && typeof value === "object" && value !== null) {
      const transform = transforms.find((t) => t.sourceKey === key)!;
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, targetKey] of Object.entries(transform.targetKeys)) {
        if (nested[nestedKey] !== undefined) {
          channelConfig[targetKey] = nested[nestedKey];
        }
      }
      if (transform.removeSource) continue;
    }

    channelConfig[key] = value;
  }

  channelConfig["enabled"] = plugin.enabled;
  return channelConfig;
}

// ---------------------------------------------------------------------------
// Main config generator
// ---------------------------------------------------------------------------

/**
 * Generates the complete openclaw.json as a plain object.
 * All secrets must be pre-resolved before calling this function.
 */
export function generateFullOpenClawConfig(
  options: FullOpenClawConfigOptions,
): Record<string, unknown> {
  const model = options.model ?? "anthropic/claude-opus-4-6";
  const backupModel = options.backupModel;
  const codingAgentName = options.codingAgent ?? "claude-code";
  const providerKey = getProviderForModel(model);
  const resolvedSecrets = options.resolvedSecrets ?? {};

  // Validate provider
  const providerDef = MODEL_PROVIDERS[providerKey as keyof typeof MODEL_PROVIDERS];
  if (providerKey !== "anthropic" && !providerDef) {
    throw new Error(
      `Unknown model provider "${providerKey}" from model "${model}". Supported: ${Object.keys(MODEL_PROVIDERS).join(", ")}`,
    );
  }

  // Build cliBackends from coding agent registry
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];
  const cliBackends = codingAgentEntry
    ? {
        "claude-cli": Object.fromEntries(
          Object.entries(codingAgentEntry.cliBackend).filter(
            ([, v]) => v !== "" && v !== "never",
          ),
        ),
      }
    : {};

  // Build model config
  const modelConfig: string | Record<string, unknown> = backupModel
    ? { primary: model, fallbacks: [backupModel] }
    : model;

  // Build env section (provider API keys + Codex/OpenRouter aliasing)
  const env: Record<string, string> = { ...options.providerEnv };

  // Codex + OpenRouter: alias credentials for OpenAI-compatible API
  if (codingAgentName === "codex" && providerKey === "openrouter") {
    const openrouterKey = env["OPENROUTER_API_KEY"] ?? "";
    env["OPENAI_API_KEY"] = openrouterKey;
    env["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1";
  }

  // Build backup provider env (if different from primary)
  if (backupModel) {
    const backupProviderKey = getProviderForModel(backupModel);
    if (backupProviderKey !== providerKey) {
      const backupProviderDef = MODEL_PROVIDERS[backupProviderKey as keyof typeof MODEL_PROVIDERS];
      if (backupProviderDef) {
        const backupEnvVar = backupProviderDef.envVar;
        // Include backup provider key if available in providerEnv
        if (options.providerEnv[backupEnvVar]) {
          env[backupEnvVar] = options.providerEnv[backupEnvVar];
        }
      }
    }
  }

  // Build plugins and channels sections
  const pluginsEntries: Record<string, unknown> = {};
  const channels: Record<string, unknown> = {};
  const hasSlackPlugin = (options.plugins ?? []).some(
    (p) => p.name === "slack" && p.configPath === "channels",
  );

  for (const plugin of options.plugins ?? []) {
    if (plugin.configPath === "channels") {
      // Channel plugin (e.g., Slack)
      channels[plugin.name] = buildChannelConfig(plugin, resolvedSecrets);
      pluginsEntries[plugin.name] = { enabled: plugin.enabled };
    } else {
      // Standard plugin (e.g., openclaw-linear)
      pluginsEntries[plugin.name] = {
        enabled: plugin.enabled,
        config: buildPluginEntryConfig(plugin, resolvedSecrets),
      };
    }
  }

  // Build the complete config
  const config: Record<string, unknown> = {
    gateway: {
      port: options.gatewayPort ?? 18789,
      mode: "local",
      trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
      controlUi: {
        enabled: options.enableControlUi ?? true,
        allowInsecureAuth: true,
      },
      auth: {
        mode: "token",
        token: options.gatewayToken,
      },
    },
    env,
    agents: {
      defaults: {
        heartbeat: { every: "1m", session: "main" },
        model: modelConfig,
        cliBackends,
      },
      ...(options.agentName
        ? {
            list: [
              {
                id: "default",
                identity: {
                  name: options.agentName,
                  ...(options.agentEmoji ? { emoji: options.agentEmoji } : {}),
                },
              },
            ],
          }
        : {}),
    },
    acp: { defaultAgent: "default" },
  };

  // Add plugins section if any plugins exist
  if (Object.keys(pluginsEntries).length > 0) {
    config["plugins"] = { entries: pluginsEntries };
  }

  // Add channels section if any channel plugins exist
  if (Object.keys(channels).length > 0) {
    config["channels"] = channels;

    // Enable allowBots when agent has identity and Slack is present
    if (options.agentName && hasSlackPlugin) {
      (channels["slack"] as Record<string, unknown>)["allowBots"] = true;
    }
  }

  // Add messages config when agent has identity
  if (options.agentName) {
    config["messages"] = { ackReaction: "eyes" };
  }

  // Add web search config if Brave API key is available
  if (options.braveApiKey) {
    config["tools"] = {
      web: { search: { provider: "brave", apiKey: options.braveApiKey } },
    };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Legacy exports (backward compat for existing callers)
// ---------------------------------------------------------------------------

/** @deprecated Use FullOpenClawConfigOptions instead */
export type OpenClawConfigOptions = FullOpenClawConfigOptions;

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
 * Generates a partial openclaw.json configuration object (gateway section only).
 * @deprecated Use generateFullOpenClawConfig() for the complete config.
 */
export function generateOpenClawConfig(options: {
  gatewayPort?: number;
  gatewayToken: string;
  trustedProxies?: string[];
  enableControlUi?: boolean;
  browserPort?: number;
  braveApiKey?: string;
  customConfig?: Record<string, unknown>;
}): OpenClawConfig {
  const config: OpenClawConfig = {
    gateway: {
      port: options.gatewayPort ?? 18789,
      mode: "local",
      trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
      controlUi: {
        enabled: options.enableControlUi ?? true,
        allowInsecureAuth: true,
      },
      auth: {
        mode: "token",
        token: options.gatewayToken,
      },
    },
  };

  if (options.browserPort) {
    config.browser = { port: options.browserPort };
  }

  if (options.braveApiKey) {
    config.tools = { web: { search: { provider: "brave", apiKey: options.braveApiKey } } };
  }

  if (options.customConfig) {
    Object.assign(config, options.customConfig);
  }

  return config;
}

/**
 * Generates openclaw.json as a JSON string (gateway section only).
 * @deprecated Use generateFullOpenClawConfig() for the complete config.
 */
export function generateOpenClawConfigJson(options: Parameters<typeof generateOpenClawConfig>[0]): string {
  return JSON.stringify(generateOpenClawConfig(options), null, 2);
}
