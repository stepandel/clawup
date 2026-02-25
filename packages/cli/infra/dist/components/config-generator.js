"use strict";
/**
 * OpenClaw configuration generator
 * Builds the openclaw.json configuration file content
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOpenClawConfig = generateOpenClawConfig;
exports.generateOpenClawConfigJson = generateOpenClawConfigJson;
exports.generateConfigPatchScript = generateConfigPatchScript;
const core_1 = require("@clawup/core");
/** Keys that are clawup-internal metadata and should NOT be written to OpenClaw config */
const INTERNAL_PLUGIN_KEYS = new Set(["agentId", "linearUserUuid"]);
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
function toPythonLiteral(value) {
    if (value === true)
        return "True";
    if (value === false)
        return "False";
    if (value === null || value === undefined)
        return "None";
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
        const entries = Object.entries(value)
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
/**
 * Generates an openclaw.json configuration object
 */
function generateOpenClawConfig(options) {
    const config = {
        gateway: {
            port: options.gatewayPort ?? 18789,
            bind: "127.0.0.1", // Bind to loopback for Tailscale Serve
            trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
            controlUi: {
                enabled: options.enableControlUi ?? true,
                allowInsecureAuth: true, // Safe behind Tailscale
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
function generateOpenClawConfigJson(options) {
    return JSON.stringify(generateOpenClawConfig(options), null, 2);
}
/**
 * Generates Python code to configure a single plugin in openclaw.json.
 * Secrets are injected from environment variables.
 *
 * Slack is special-cased: it writes to config["channels"]["slack"] (channel config)
 * AND config["plugins"]["entries"]["slack"] (plugin entry).
 */
function generatePluginPython(plugin) {
    if (plugin.name === "slack") {
        return generateSlackPluginPython(plugin);
    }
    // Build the config dict, injecting secrets from env vars
    const configEntries = [];
    // Secret env var values
    if (plugin.secretEnvVars) {
        for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
            configEntries.push(`        "${configKey}": os.environ.get("${envVar}", "")`);
        }
    }
    // Non-secret config values (filter out clawup-internal metadata)
    for (const [key, value] of Object.entries(plugin.config)) {
        if (INTERNAL_PLUGIN_KEYS.has(key))
            continue;
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
 * Generates Python code for Slack channel + plugin configuration.
 * Slack writes to config["channels"]["slack"] with secrets from env vars
 * and non-secret config from plugin defaults, plus enables the plugin entry.
 */
function generateSlackPluginPython(plugin) {
    // Build channel config entries from non-secret plugin config
    const channelEntries = [];
    // Secret env var values (botToken, appToken)
    if (plugin.secretEnvVars) {
        for (const [configKey, envVar] of Object.entries(plugin.secretEnvVars)) {
            channelEntries.push(`    "${configKey}": os.environ.get("${envVar}", "")`);
        }
    }
    // Non-secret config values (mode, userTokenReadOnly, groupPolicy, dm, etc.)
    for (const [key, value] of Object.entries(plugin.config)) {
        if (INTERNAL_PLUGIN_KEYS.has(key))
            continue;
        // Flatten dm nested object → top-level dmPolicy/allowFrom (OpenClaw schema)
        if (key === "dm" && typeof value === "object" && value !== null) {
            const dm = value;
            if (dm.policy)
                channelEntries.push(`    "dmPolicy": ${toPythonLiteral(dm.policy)}`);
            if (dm.allowFrom)
                channelEntries.push(`    "allowFrom": ${toPythonLiteral(dm.allowFrom)}`);
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
function generateConfigPatchScript(options) {
    const configPatches = {
        trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
        enableControlUi: options.enableControlUi ?? true,
    };
    // Build model config (primary + optional fallbacks)
    const model = options.model ?? "anthropic/claude-opus-4-6";
    const backupModel = options.backupModel;
    // Build cliBackends config from coding agent registry
    const codingAgentName = options.codingAgent ?? "claude-code";
    const codingAgentEntry = core_1.CODING_AGENT_REGISTRY[codingAgentName];
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
    config.setdefault("tools", {})
    config["tools"].setdefault("web", {})
    config["tools"]["web"]["search"] = {"provider": "brave", "apiKey": brave_api_key}
    print("Configured web search with Brave API key")

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Configured gateway with trustedProxies, controlUi, and token auth")
`.trim();
}
//# sourceMappingURL=config-generator.js.map