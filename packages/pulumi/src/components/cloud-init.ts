/**
 * Cloud-init script generator for OpenClaw agents.
 *
 * Generates a self-contained bash provisioner by:
 * 1. Building a typed ProvisionerConfig JSON blob (all logic in TypeScript)
 * 2. Embedding the JSON directly via a quoted heredoc in the bash template
 * 3. The bash template reads the JSON via jq and executes phases mechanically
 *
 * Secrets are embedded directly in the JSON (already resolved by Pulumi).
 * No interpolation pass is needed.
 */

import * as zlib from "zlib";
import { PROVISIONER_TEMPLATE } from "./provisioner-template";
import { buildProvisionerConfig } from "./provisioner-config";

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
  /** Lifecycle hooks from the plugin manifest */
  hooks?: {
    resolve?: Record<string, string>;
    postProvision?: string;
    preStart?: string;
  };
}

export interface CloudInitConfig {
  /** Per-provider API keys: { providerKey: resolvedValue } e.g., { anthropic: "sk-ant-...", openai: "sk-..." } */
  providerApiKeys: Record<string, string>;
  /** Model provider key (e.g., "anthropic", "openai"). Defaults to "anthropic". */
  modelProvider?: string;
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
  deps?: { name: string; installScript: string; postInstallScript: string; secrets: Record<string, { envVar: string }> }[];
  /** Resolved dep secret values merged into additionalSecrets for interpolation */
  depSecrets?: Record<string, string>;
  /** Whether to enable Tailscale Funnel (public HTTPS) instead of Serve */
  enableFunnel?: boolean;
  /** Public skill slugs to install via `clawhub install` */
  clawhubSkills?: string[];
}

/**
 * Generates a cloud-init bash script for OpenClaw deployment.
 *
 * Builds a typed ProvisionerConfig, serializes it to JSON, and embeds it
 * directly into the bash template via a quoted heredoc. This avoids
 * a base64 encoding layer, saving ~15-20% on final compressed size.
 */
export function generateCloudInit(config: CloudInitConfig): string {
  const provConfig = buildProvisionerConfig(config);
  const configJson = JSON.stringify(provConfig);
  return PROVISIONER_TEMPLATE.replace("__CONFIG_HEREDOC__", configJson);
}

/**
 * Wraps a cloud-init script in a gzip+base64 self-extracting bootstrap.
 * Hetzner limits user_data to 32KB; this typically achieves 60-70% compression.
 */
export function compressCloudInit(script: string): string {
  const compressed = zlib.gzipSync(Buffer.from(script, "utf-8")).toString("base64");
  return `#!/bin/bash
base64 -d <<'COMPRESSED_PAYLOAD' | gunzip | bash
${compressed}
COMPRESSED_PAYLOAD
`;
}
