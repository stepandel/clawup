/**
 * OpenClaw configuration generator
 * Builds the openclaw.json configuration file content
 */

import { CODING_AGENT_REGISTRY } from "@clawup/core";

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
}

/** Keys that are clawup-internal metadata and should NOT be written to OpenClaw config */
const INTERNAL_PLUGIN_KEYS = new Set(["agentId", "linearUserUuid"]);

/**
 * Convert a JS value to a Python literal string (recursive).
 * Booleans: true→True, false→False. null/undefined→None.
 * Arrays and objects are recursively converted.
 */
function toPythonLiteral(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  if (value === null || value === undefined) return "None";
  if (Array.isArray(value)) {
    return `[${value.map(toPythonLiteral).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `"${k}": ${toPythonLiteral(v)}`)
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
  web?: {
    search: {
      provider: string;
      apiKey: string;
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
    config.web = { search: { provider: "brave", apiKey: options.braveApiKey } };
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
 * Slack is special-cased: it writes to config["channels"]["slack"] (channel config)
 * AND config["plugins"]["entries"]["slack"] (plugin entry).
 */
function generatePluginPython(plugin: PluginEntry): string {
  if (plugin.name === "slack") {
    return generateSlackPluginPython(plugin);
  }

  // Build the config dict, injecting secrets from env vars
  const configEntries: string[] = [];

  // Secret env var values
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      configEntries.push(`        "${configKey}": os.environ.get("${envVar}", "")`);
    }
  }

  // Non-secret config values (filter out clawup-internal metadata)
  for (const [key, value] of Object.entries(plugin.config)) {
    if (INTERNAL_PLUGIN_KEYS.has(key)) continue;
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
config["plugins"]["entries"]["${plugin.name}"] = {
    "enabled": ${plugin.enabled ? "True" : "False"},
    "config": ${configBlock}
}
print("Configured ${plugin.name} plugin")
`;
}

/**
 * Generates Python code for Slack channel + plugin configuration.
 * Slack writes to config["channels"]["slack"] with secrets from env vars
 * and non-secret config from plugin defaults, plus enables the plugin entry.
 */
function generateSlackPluginPython(plugin: PluginEntry): string {
  // Build channel config entries from non-secret plugin config
  const channelEntries: string[] = [];

  // Secret env var values (botToken, appToken)
  if (plugin.secretEnvVars) {
    for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
      channelEntries.push(`    "${configKey}": os.environ.get("${envVar}", "")`);
    }
  }

  // Non-secret config values (mode, userTokenReadOnly, groupPolicy, dm, etc.)
  for (const [key, value] of Object.entries(plugin.config)) {
    if (INTERNAL_PLUGIN_KEYS.has(key)) continue;
    // Flatten dm nested object → top-level dmPolicy/allowFrom (OpenClaw schema)
    if (key === "dm" && typeof value === "object" && value !== null) {
      const dm = value as Record<string, unknown>;
      if (dm.policy) channelEntries.push(`    "dmPolicy": ${toPythonLiteral(dm.policy)}`);
      if (dm.allowFrom) channelEntries.push(`    "allowFrom": ${toPythonLiteral(dm.allowFrom)}`);
      continue;
    }
    channelEntries.push(`    "${key}": ${toPythonLiteral(value)}`);
  }

  // Add enabled: True
  channelEntries.push(`    "enabled": True`);

  const channelBlock = channelEntries.length > 0
    ? `{
${channelEntries.join(",\n")}
}`
    : "{}";

  return `
# Configure Slack channel (Socket Mode) and plugin
config.setdefault("channels", {})
config["channels"]["slack"] = ${channelBlock}
config.setdefault("plugins", {})
config["plugins"].setdefault("entries", {})
config["plugins"]["entries"]["slack"] = {"enabled": ${plugin.enabled ? "True" : "False"}}
print("Configured Slack channel with Socket Mode")
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

# Configure environment variables for child processes (including Claude Code, Linear CLI)
# Auto-detect credential type: OAuth token (oat) vs API key (api)
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
    print("Configured environment variables: ANTHROPIC_API_KEY (API key)")

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
    config.setdefault("web", {})
    config["web"]["search"] = {"provider": "brave", "apiKey": brave_api_key}
    print("Configured web search with Brave API key")

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Configured gateway with trustedProxies, controlUi, and token auth")
`.trim();
}
