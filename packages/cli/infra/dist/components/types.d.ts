/**
 * Shared types for OpenClaw agent components (AWS + Hetzner)
 */
import * as pulumi from "@pulumi/pulumi";
import type { PluginInstallConfig } from "./cloud-init";
/**
 * Resolved dep from the dep registry, ready for cloud-init.
 */
export interface DepInstallConfig {
    name: string;
    installScript: string;
    postInstallScript: string;
    secrets: Record<string, {
        envVar: string;
    }>;
}
/**
 * Base arguments shared by all provider-specific agent components.
 */
export interface BaseOpenClawAgentArgs {
    /** Anthropic API key (required) */
    anthropicApiKey: pulumi.Input<string>;
    /** Tailscale auth key for secure access (required) */
    tailscaleAuthKey: pulumi.Input<string>;
    /** Your Tailnet DNS name (e.g., tailxxxxx.ts.net) */
    tailnetDnsName: pulumi.Input<string>;
    /** AI model to use (default: anthropic/claude-opus-4-6) */
    model?: pulumi.Input<string>;
    /** Backup/fallback model (e.g., "anthropic/claude-sonnet-4-5") */
    backupModel?: pulumi.Input<string>;
    /** Coding agent CLI name (e.g., "claude-code", "codex", "amp") */
    codingAgent?: string;
    /** Enable Docker sandbox for code execution (default: true) */
    enableSandbox?: pulumi.Input<boolean>;
    /** Gateway port (default: 18789) */
    gatewayPort?: pulumi.Input<number>;
    /** Browser control port (default: 18791) */
    browserPort?: pulumi.Input<number>;
    /** Workspace files to inject (path -> content) */
    workspaceFiles?: Record<string, string>;
    /** Additional environment variables for the agent */
    envVars?: Record<string, string>;
    /** Custom post-setup shell commands */
    postSetupCommands?: string[];
    /** Plugins to install and configure on this agent */
    plugins?: PluginInstallConfig[];
    /** Resolved secret values for plugin env vars: { envVarName: pulumiOutput } */
    pluginSecrets?: Record<string, pulumi.Input<string>>;
    /** Resolved deps from the dep registry */
    deps?: DepInstallConfig[];
    /** Dep secret Pulumi outputs: { envVarName: pulumiOutput } */
    depSecrets?: Record<string, pulumi.Input<string>>;
    /** Whether to enable Tailscale Funnel (public HTTPS for webhooks) */
    enableFunnel?: boolean;
    /** Public skill slugs to install via `clawhub install` */
    clawhubSkills?: string[];
}
//# sourceMappingURL=types.d.ts.map