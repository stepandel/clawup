/**
 * OpenClaw configuration generator.
 *
 * Generates openclaw.json configuration objects. The config patching logic
 * (previously generateConfigPatchBash) has moved to provisioner-config.ts
 * which produces structured JSON consumed by the bash provisioner template.
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
