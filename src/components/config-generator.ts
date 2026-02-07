/**
 * OpenClaw configuration generator
 * Builds the openclaw.json configuration file content
 */

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

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Configured gateway with trustedProxies, controlUi, and token auth")
`.trim();
}
