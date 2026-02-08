/**
 * OpenClaw configuration generator
 * Builds the openclaw.json configuration file content
 */

export interface SlackConfigOptions {
  /** Slack bot token (xoxb-...) */
  botToken: string;
  /** Slack app token for Socket Mode (xapp-...) */
  appToken: string;
}

export interface LinearConfigOptions {
  /** Linear API key */
  apiKey: string;
}

export interface OpenClawConfigOptions {
  /** Gateway port (default: 18789) */
  gatewayPort?: number;
  /** Browser control port (default: 18791) */
  browserPort?: number;
  /** Gateway authentication token */
  gatewayToken: string;
  /** Default AI model (default: anthropic/claude-sonnet-4) */
  model?: string;
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
  /** Slack configuration */
  slack?: SlackConfigOptions;
  /** Linear configuration */
  linear?: LinearConfigOptions;
  /** Brave Search API key */
  braveSearchApiKey?: string;
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

  if (options.model) {
    config.model = options.model;
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
 * Generates Python script for modifying existing openclaw.json
 * Used in cloud-init after onboarding creates the initial config
 */
export function generateConfigPatchScript(options: OpenClawConfigOptions): string {
  const configPatches = {
    trustedProxies: options.trustedProxies ?? ["127.0.0.1"],
    enableControlUi: options.enableControlUi ?? true,
  };

  // Build Slack channel config section if credentials provided
  const slackChannelConfig = options.slack
    ? `
# Configure Slack channel (Socket Mode)
config.setdefault("channels", {})
config["channels"]["slack"] = {
    "mode": "socket",
    "enabled": True,
    "botToken": os.environ.get("SLACK_BOT_TOKEN", ""),
    "appToken": os.environ.get("SLACK_APP_TOKEN", ""),
    "userTokenReadOnly": True,
    "groupPolicy": "open",
    "dm": {
        "enabled": True,
        "policy": "open",
        "allowFrom": ["*"]
    }
}

# Enable Slack plugin
config.setdefault("plugins", {})
config["plugins"].setdefault("entries", {})
config["plugins"]["entries"]["slack"] = {"enabled": True}
print("Configured Slack channel with Socket Mode")
`
    : "";

  // Build Linear skill config section if credentials provided
  const linearSkillConfig = options.linear
    ? `
# Configure Linear skill
config.setdefault("skills", {})
config["skills"].setdefault("entries", {})
config["skills"]["entries"]["linear"] = {
    "enabled": True,
    "apiKey": os.environ.get("LINEAR_API_KEY", "")
}
print("Configured Linear skill")
`
    : "";

  // Build Brave Search skill config section if API key provided
  const braveSearchConfig = options.braveSearchApiKey
    ? `
# Configure Brave Search skill
config.setdefault("skills", {})
config["skills"].setdefault("entries", {})
config["skills"]["entries"]["brave-search"] = {
    "enabled": True,
    "apiKey": os.environ.get("BRAVE_SEARCH_API_KEY", "")
}
print("Configured Brave Search skill")
`
    : "";

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

# Configure environment variables for child processes (including Claude Code)
config["env"] = {
    "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")
}
print("Configured environment variables")
${slackChannelConfig}${linearSkillConfig}${braveSearchConfig}
with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Configured gateway with trustedProxies, controlUi, and token auth")
`.trim();
}
