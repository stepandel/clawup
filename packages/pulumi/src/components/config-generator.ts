/**
 * OpenClaw configuration generator
 * Builds the openclaw.json configuration file content
 */

import { CODING_AGENT_REGISTRY, MODEL_PROVIDERS, getProviderForModel } from "@clawup/core";

/**
 * A single plugin entry for the OpenClaw config.
 * Used to dynamically generate Python config-patch code for each plugin.
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
 * Convert a JS value to a Python literal string (recursive).
 * Booleans: true→True, false→False. null/undefined→None.
 * Arrays and objects are recursively converted.
 *
 * Strings matching $ENV_VAR are emitted as os.environ.get("ENV_VAR", "")
 * instead of literal strings. This works for both dict keys and values,
 * allowing plugin configs to reference runtime environment variables.
 */
function toPythonLiteral(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") {
    const envMatch = value.match(ENV_VAR_PATTERN);
    if (envMatch) {
      return `os.environ.get("${envMatch[1]}", "")`;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(toPythonLiteral).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const keyEnvMatch = k.match(ENV_VAR_PATTERN);
        const pyKey = keyEnvMatch
          ? `os.environ.get("${keyEnvMatch[1]}", "")`
          : `"${k}"`;
        return `${pyKey}: ${toPythonLiteral(v)}`;
      })
      .join(", ");
    return `{${entries}}`;
  }
  return JSON.stringify(value);
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
    bind: string;
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
  sandbox?: {
    enabled: boolean;
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
      bind: "127.0.0.1",  // Bind to loopback for Tailscale Serve
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

  if (options.enableSandbox !== undefined) {
    config.sandbox = {
      enabled: options.enableSandbox,
    };
  }

  // Note: model config is now handled in generateConfigPatchScript() via agents.defaults.model

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
 * Generates Python code to configure a single plugin in openclaw.json.
 * Secrets are injected from environment variables.
 *
 * The configPath field drives which code path is used:
 * - "channels": writes to config["channels"]["<name>"] (channel config)
 * - "plugins.entries": writes to config["plugins"]["entries"]["<name>"] (plugin entry)
 */
function generatePluginPython(plugin: PluginEntry): string {
  if (plugin.configPath === "channels") {
    return generateChannelPluginPython(plugin);
  }

  const internalKeys = new Set(plugin.internalKeys ?? []);

  // Build the config dict, injecting secrets from env vars
  const configEntries: string[] = [];

  // Secret env var values
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      configEntries.push(`        "${configKey}": os.environ.get("${envVar}", "")`);
    }
  }

  // Non-secret config values (filter out internal metadata)
  for (const [key, value] of Object.entries(plugin.config)) {
    if (internalKeys.has(key)) continue;
    configEntries.push(`        "${key}": ${toPythonLiteral(value)}`);
  }

  const configBlock = configEntries.length > 0
    ? `{
${configEntries.join(",\n")}
    }`
    : "{}";

  return `
# Configure ${plugin.name} plugin
config.setdefault("plugins", {})
config["plugins"].setdefault("entries", {})
config["plugins"]["entries"].setdefault("${plugin.name}", {})
config["plugins"]["entries"]["${plugin.name}"]["enabled"] = ${plugin.enabled ? "True" : "False"}
config["plugins"]["entries"]["${plugin.name}"].setdefault("config", {})
config["plugins"]["entries"]["${plugin.name}"]["config"].update(${configBlock})
print("Configured ${plugin.name} plugin")
`;
}

/**
 * Generates Python code for channel-based plugin configuration.
 * Writes to config["channels"]["<name>"] with secrets from env vars
 * and non-secret config from plugin defaults, plus enables the plugin entry.
 *
 * Config transforms (e.g., dm → dmPolicy/allowFrom flattening) are applied
 * generically based on the plugin's configTransforms definition.
 */
function generateChannelPluginPython(plugin: PluginEntry): string {
  const internalKeys = new Set(plugin.internalKeys ?? []);
  const transforms = plugin.configTransforms ?? [];
  const transformSourceKeys = new Set(transforms.map((t) => t.sourceKey));

  // Build channel config entries from non-secret plugin config
  const channelEntries: string[] = [];

  // Secret env var values
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      channelEntries.push(`    "${configKey}": os.environ.get("${envVar}", "")`);
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
          channelEntries.push(`    "${targetKey}": ${toPythonLiteral(nested[nestedKey])}`);
        }
      }
      // Only skip the source key if removeSource is true
      if (transform.removeSource) continue;
    }

    channelEntries.push(`    "${key}": ${toPythonLiteral(value)}`);
  }

  // Add enabled flag from plugin config
  channelEntries.push(`    "enabled": ${plugin.enabled ? "True" : "False"}`);

  const channelBlock = channelEntries.length > 0
    ? `{
${channelEntries.join(",\n")}
}`
    : "{}";

  return `
# Configure ${plugin.name} channel and plugin
config.setdefault("channels", {})
config["channels"]["${plugin.name}"] = ${channelBlock}
config.setdefault("plugins", {})
config["plugins"].setdefault("entries", {})
config["plugins"]["entries"]["${plugin.name}"] = {"enabled": ${plugin.enabled ? "True" : "False"}}
print("Configured ${plugin.name} channel")
`;
}

/**
 * Generates Python script for modifying existing openclaw.json
 * Used in cloud-init after onboarding creates the initial config
 */
export function generateConfigPatchScript(options: OpenClawConfigOptions): string {
  const configPatches = {
    trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
    enableControlUi: options.enableControlUi ?? true,
  };

  // Build model config (primary + optional fallbacks)
  const model = options.model ?? "anthropic/claude-opus-4-6";
  const backupModel = options.backupModel;
  const providerKey = getProviderForModel(model);
  const providerDef = MODEL_PROVIDERS[providerKey as keyof typeof MODEL_PROVIDERS] as
    | (typeof MODEL_PROVIDERS)[keyof typeof MODEL_PROVIDERS]
    | undefined;
  if (providerKey !== "anthropic" && !providerDef) {
    throw new Error(`Unknown model provider "${providerKey}" from model "${model}". Supported: ${Object.keys(MODEL_PROVIDERS).join(", ")}`);
  }

  // Build cliBackends config from coding agent registry
  const codingAgentName = options.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];
  const cliBackendsJson = codingAgentEntry
    ? JSON.stringify({ "claude-cli": codingAgentEntry.cliBackend })
    : "{}";

  // Build dynamic plugin config sections
  const pluginConfigs = (options.plugins ?? [])
    .map((plugin) => generatePluginPython(plugin))
    .join("");

  return `
import json
import os

config_path = "/home/ubuntu/.openclaw/openclaw.json"

with open(config_path) as f:
    config = json.load(f)

# Configure gateway for Tailscale Serve
config["gateway"]["trustedProxies"] = ${JSON.stringify(configPatches.trustedProxies)}
config["gateway"]["controlUi"] = {
    "enabled": ${configPatches.enableControlUi ? "True" : "False"},
    "allowInsecureAuth": True
}
config["gateway"]["auth"] = {
    "mode": "token",
    "token": os.environ["GATEWAY_TOKEN"]
}

# Configure environment variables for child processes (model provider API key)
${providerKey === "anthropic" ? `# Anthropic: auto-detect credential type (OAuth token vs API key)
anthropic_cred = os.environ.get("ANTHROPIC_API_KEY", "")
if anthropic_cred.startswith("sk-ant-oat"):
    # OAuth token from Claude Pro/Max subscription (use with CLAUDE_CODE_OAUTH_TOKEN)
    config["env"] = {
        "CLAUDE_CODE_OAUTH_TOKEN": anthropic_cred
    }
    print("Configured environment variables: CLAUDE_CODE_OAUTH_TOKEN (OAuth/subscription)")
else:
    # API key from Anthropic Console (use with ANTHROPIC_API_KEY)
    config["env"] = {
        "ANTHROPIC_API_KEY": anthropic_cred
    }
    print("Configured environment variables: ANTHROPIC_API_KEY (API key)")` : `# ${providerDef?.name ?? providerKey}: set provider API key env var
provider_key = os.environ.get("${providerDef?.envVar ?? "MODEL_API_KEY"}", "")
config["env"] = {
    "${providerDef?.envVar ?? "MODEL_API_KEY"}": provider_key
}
print("Configured environment variables: ${providerDef?.envVar ?? "MODEL_API_KEY"}")`}

# Configure heartbeat (proactive mode)
config.setdefault("agents", {})
config["agents"].setdefault("defaults", {})
config["agents"]["defaults"]["heartbeat"] = {
    "every": "1m",
    "session": "main"
}
print("Configured heartbeat: every 1m")

# Configure model with optional fallbacks
${backupModel
    ? `config["agents"]["defaults"]["model"] = {
    "primary": "${model}",
    "fallbacks": ["${backupModel}"]
}
print("Configured model: ${model} (fallback: ${backupModel})")`
    : `config["agents"]["defaults"]["model"] = "${model}"
print("Configured model: ${model}")`}

# Configure coding agent CLI backend
config["agents"]["defaults"]["cliBackends"] = ${cliBackendsJson}
print("Configured cliBackends for ${codingAgentName}")
${pluginConfigs}
# Configure agent identity for Slack mentions/tags
agent_name = os.environ.get("AGENT_NAME", "")
agent_emoji = os.environ.get("AGENT_EMOJI", "")
if agent_name:
    config.setdefault("agents", {})
    config["agents"].setdefault("list", [])
    # Find or create the "default" agent entry
    default_agent = None
    for agent in config["agents"]["list"]:
        if agent.get("id") == "default":
            default_agent = agent
            break
    if not default_agent:
        default_agent = {"id": "default"}
        config["agents"]["list"].append(default_agent)
    default_agent.setdefault("identity", {})
    default_agent["identity"]["name"] = agent_name
    if agent_emoji:
        default_agent["identity"]["emoji"] = agent_emoji
    print(f"Configured agent identity: {agent_name} (:{agent_emoji}:)")

    # Enable allowBots so agents can see each other's messages in shared channels
    if "channels" in config and "slack" in config["channels"]:
        config["channels"]["slack"]["allowBots"] = True
        print("Enabled allowBots for Slack channel")

    # Add ack reaction for visual feedback when processing messages
    config.setdefault("messages", {})
    config["messages"]["ackReaction"] = "eyes"
    print("Configured ackReaction: eyes")

# Configure web search (Brave API key) if available
brave_api_key = os.environ.get("BRAVE_API_KEY", "")
if brave_api_key:
    config.setdefault("tools", {})
    config["tools"].setdefault("web", {})
    config["tools"]["web"]["search"] = {"provider": "brave", "apiKey": brave_api_key}
    print("Configured web search with Brave API key")

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Configured gateway with trustedProxies, controlUi, and token auth")
`.trim();
}
