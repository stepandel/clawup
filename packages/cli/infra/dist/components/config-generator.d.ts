/**
 * OpenClaw configuration generator
 * Builds the openclaw.json configuration file content
 */
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
export declare function generateOpenClawConfig(options: OpenClawConfigOptions): OpenClawConfig;
/**
 * Generates openclaw.json as a JSON string
 */
export declare function generateOpenClawConfigJson(options: OpenClawConfigOptions): string;
/**
 * Generates Python script for modifying existing openclaw.json
 * Used in cloud-init after onboarding creates the initial config
 */
export declare function generateConfigPatchScript(options: OpenClawConfigOptions): string;
//# sourceMappingURL=config-generator.d.ts.map