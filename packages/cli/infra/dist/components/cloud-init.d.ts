/**
 * Cloud-init script generator for OpenClaw agents
 * Generates the user-data script for EC2 instance provisioning
 */
/**
 * Config for a plugin to be installed on an agent.
 */
export interface PluginInstallConfig {
    /** Plugin package name (e.g., "openclaw-linear") */
    name: string;
    /** Non-secret config for this plugin's agent section */
    config?: Record<string, unknown>;
    /**
     * Env var mappings for secrets: { configKey: envVarName }
     * e.g., { "apiKey": "LINEAR_API_KEY", "webhookSecret": "LINEAR_WEBHOOK_SECRET" }
     */
    secretEnvVars?: Record<string, string>;
    /** false for built-in plugins like Slack that don't need `openclaw plugins install` */
    installable?: boolean;
}
export interface CloudInitConfig {
    /** Anthropic API key (for backward compatibility) */
    anthropicApiKey: string;
    /** Tailscale auth key */
    tailscaleAuthKey: string;
    /** Gateway authentication token */
    gatewayToken: string;
    /** Gateway port (default: 18789) */
    gatewayPort?: number;
    /** Browser control port (default: 18791) */
    browserPort?: number;
    /** Enable Docker sandbox (default: true) */
    enableSandbox?: boolean;
    /** AI model to use (default: anthropic/claude-opus-4-6) */
    model?: string;
    /** Backup/fallback model for OpenClaw (e.g., "anthropic/claude-sonnet-4-5") */
    backupModel?: string;
    /** Coding agent CLI name (e.g., "claude-code"). Defaults to "claude-code". */
    codingAgent?: string;
    /** Node.js version to install (default: 22) */
    nodeVersion?: number;
    /** NVM version to install (default: 0.40.1) */
    nvmVersion?: string;
    /** OpenClaw version (default: latest) */
    openclawVersion?: string;
    /** Trusted proxies for gateway (default: ["127.0.0.1"]) */
    trustedProxies?: string[];
    /** Workspace files to inject (path -> content) */
    workspaceFiles?: Record<string, string>;
    /** Additional environment variables */
    envVars?: Record<string, string>;
    /** Custom shell commands to run after OpenClaw setup */
    postSetupCommands?: string[];
    /** Tailscale hostname (default: system hostname) */
    tailscaleHostname?: string;
    /** Skip Tailscale installation (default: false) */
    skipTailscale?: boolean;
    /** Skip Docker installation (default: false) — for local Docker where Docker is the host */
    skipDocker?: boolean;
    /** Run OpenClaw daemon in foreground instead of systemd (default: false) — keeps container alive */
    foregroundMode?: boolean;
    /** Create ubuntu user (for Hetzner which uses root) */
    createUbuntuUser?: boolean;
    /** Plugins to install and configure */
    plugins?: PluginInstallConfig[];
    /** Resolved dep entries to install */
    deps?: {
        name: string;
        installScript: string;
        postInstallScript: string;
        secrets: Record<string, {
            envVar: string;
        }>;
    }[];
    /** Resolved dep secret values merged into additionalSecrets for interpolation */
    depSecrets?: Record<string, string>;
    /** Whether to enable Tailscale Funnel (public HTTPS) instead of Serve */
    enableFunnel?: boolean;
    /** Public skill slugs to install via `clawhub install` */
    clawhubSkills?: string[];
}
/**
 * Generates a cloud-init bash script for OpenClaw deployment
 */
export declare function generateCloudInit(config: CloudInitConfig): string;
/**
 * Interpolates environment variables in the cloud-init script.
 * Call this with actual values before passing to EC2 user data.
 *
 * Base secrets (anthropic, tailscale, gateway, slack, github, brave) are always handled.
 * Plugin secrets are passed via the additionalSecrets map.
 */
export declare function interpolateCloudInit(script: string, values: {
    anthropicApiKey: string;
    tailscaleAuthKey: string;
    gatewayToken: string;
    /** Additional secret env vars from plugins and deps: { envVarName: value } */
    additionalSecrets?: Record<string, string>;
}): string;
/**
 * Wraps a cloud-init script in a gzip+base64 self-extracting bootstrap.
 * Hetzner limits user_data to 32KB; this typically achieves 60-70% compression.
 */
export declare function compressCloudInit(script: string): string;
//# sourceMappingURL=cloud-init.d.ts.map