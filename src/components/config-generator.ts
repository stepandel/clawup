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

export interface LinearActiveActions {
  /** Workflow states that remove items from the queue */
  remove?: string[];
  /** Workflow states that add items to the queue */
  add?: string[];
}

export interface LinearConfigOptions {
  /** Linear API key */
  apiKey: string;
  /** Linear webhook signing secret */
  webhookSecret?: string;
  /** Agent ID (e.g., "agent-pm") for the agent mapping */
  agentId?: string;
  /** Linear user UUID for this agent */
  agentLinearUserUuid?: string;
  /** Active actions config (which workflow states trigger queue add/remove) */
  activeActions?: LinearActiveActions;
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

  // Build Linear plugin config section if credentials provided
  const linearPluginConfig = options.linear
    ? (() => {
        const agentMapping: Record<string, string> = {};
        if (!!options.linear.agentLinearUserUuid !== !!options.linear.agentId) {
          throw new Error(
            "linear.agentLinearUserUuid and linear.agentId must be provided together to build agentMapping."
          );
        }
        if (options.linear.agentLinearUserUuid && options.linear.agentId) {
          agentMapping[options.linear.agentLinearUserUuid] = options.linear.agentId;
        }
        const agentMappingJson = JSON.stringify(agentMapping);

        // Transform activeActions { remove: [...], add: [...] } to
        // stateActions { "stateName": "add"|"remove" } for the plugin schema
        let stateActionsJson: string | null = null;
        if (options.linear.activeActions) {
          const stateActions: Record<string, string> = {};
          for (const state of options.linear.activeActions.remove ?? []) {
            stateActions[state] = "remove";
          }
          for (const state of options.linear.activeActions.add ?? []) {
            stateActions[state] = "add";
          }
          stateActionsJson = JSON.stringify(stateActions);
        }

        return `
# Configure openclaw-linear plugin
config.setdefault("plugins", {})
config["plugins"].setdefault("entries", {})
config["plugins"]["entries"]["openclaw-linear"] = {
    "enabled": True,
    "config": {
        "apiKey": os.environ.get("LINEAR_API_KEY", ""),
        "webhookSecret": os.environ.get("LINEAR_WEBHOOK_SECRET", ""),
        "agentMapping": ${agentMappingJson}${stateActionsJson ? `,
        "stateActions": ${stateActionsJson}` : ""}
    }
}
print("Configured openclaw-linear plugin")
`;
      })()
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
${slackChannelConfig}${linearPluginConfig}
with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Configured gateway with trustedProxies, controlUi, and token auth")
`.trim();
}
