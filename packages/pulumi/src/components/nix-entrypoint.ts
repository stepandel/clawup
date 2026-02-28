/**
 * Nix entrypoint generator for OpenClaw agents in pre-built NixOS Docker containers.
 *
 * Generates a minimal (~60 line) bash script that performs runtime-only configuration:
 * write secrets, install coding agent CLI, inject workspace files, and start the gateway.
 *
 * Eliminates all provisioning steps that are baked into the Nix Docker image:
 * - No apt-get / package installation
 * - No Docker installation
 * - No NVM / Node.js installation (Node.js is on PATH via Nix)
 * - No user creation (openclaw user is baked into image)
 * - No Tailscale (not used by local Docker provider)
 * - No systemd (foreground mode only)
 */

import * as zlib from "zlib";
import { CODING_AGENT_REGISTRY } from "@clawup/core";
import type { PluginInstallConfig } from "./cloud-init";

export interface NixEntrypointConfig {
  /** Pre-built openclaw.json content (complete, with secrets resolved) */
  openclawConfigJson: string;
  /** OAuth-resolved provider env var map: { envVarName: value } */
  providerEnv?: Record<string, string>;
  /** Gateway authentication token */
  gatewayToken: string;
  /** Coding agent CLI name (e.g., "claude-code", "codex") */
  codingAgent?: string;
  /** AI model string (e.g., "anthropic/claude-opus-4-6") */
  model?: string;
  /** Workspace files to inject (path -> content) */
  workspaceFiles?: Record<string, string>;
  /** Additional environment variables */
  envVars?: Record<string, string>;
  /** Plugins to install */
  plugins?: PluginInstallConfig[];
  /** Resolved dep entries (only postInstallScript is used — install scripts are baked into image) */
  deps?: { name: string; postInstallScript: string; secrets: Record<string, { envVar: string }> }[];
  /** Public skill slugs to install via `clawhub install` */
  clawhubSkills?: string[];
  /** Custom post-setup shell commands */
  postSetupCommands?: string[];
}

const HOME = "/home/openclaw";

/**
 * Generates a minimal bash entrypoint for a Nix-based OpenClaw Docker container.
 *
 * The script assumes:
 * - openclaw-gateway, Node.js, pnpm, git, gh, etc. are on PATH (baked into image)
 * - Running as the `openclaw` user (uid 1000)
 * - No sudo, no NVM, no apt-get needed
 */
export function generateNixEntrypoint(config: NixEntrypointConfig): string {
  const codingAgentName = config.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];

  // Provider env var exports
  const providerExports = Object.entries(config.providerEnv ?? {})
    .map(([envVar, _]) => `export ${envVar}="\${${envVar}}"`)
    .join("\n");

  // Plugin secret env var exports
  const pluginSecretExports = (config.plugins ?? [])
    .flatMap((p) => Object.values(p.secretEnvVars ?? {}))
    .map((envVar) => `[ -n "\${${envVar}:-}" ] && export ${envVar}="\${${envVar}:-}"`)
    .join("\n");

  // Dep secret env var exports
  const depSecretExports = (config.deps ?? [])
    .flatMap((d) => Object.values(d.secrets).map((s) => s.envVar))
    .map((envVar) => `[ -n "\${${envVar}:-}" ] && export ${envVar}="\${${envVar}:-}"`)
    .join("\n");

  // Additional env var exports
  const additionalEnvExports = config.envVars
    ? Object.entries(config.envVars)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join("\n")
    : "";

  // Git identity configuration
  const gitIdentityScript = config.envVars?.AGENT_NAME
    ? `
# Configure git identity for coding agent commits
git config --global user.name "${config.envVars.AGENT_NAME}"
git config --global user.email "${config.envVars.AGENT_NAME.toLowerCase().replace(/[^a-z0-9]/g, "")}@clawup.sh"
echo "Configured git identity: ${config.envVars.AGENT_NAME}"`
    : "";

  // Coding agent CLI install (simplified for Nix — no NVM, no sudo)
  const codingAgentInstallScript = codingAgentEntry
    ? generateNixCodingAgentInstall(codingAgentName, config.model)
    : "";

  // Dep post-install scripts (no sudo, running as openclaw user)
  const depPostInstallScript = (config.deps ?? [])
    .filter((d) => d.postInstallScript)
    .map((d) => `
# Post-install: ${d.name}
${d.postInstallScript}`)
    .join("\n");

  // Plugin install steps
  const installablePlugins = (config.plugins ?? []).filter((p) => p.installable !== false);
  const pluginInstallScript = installablePlugins.length > 0
    ? `
# Install OpenClaw plugins
echo "Installing plugins..."
${installablePlugins.map((p) =>
  `openclaw plugins install ${p.name} || echo "WARNING: ${p.name} plugin install failed."`,
).join("\n")}
echo "Plugin installation complete"`
    : "";

  // Plugin postProvision hooks
  const postProvisionHooksScript = (config.plugins ?? [])
    .filter((p) => p.hooks?.postProvision)
    .map((p) => `
# postProvision hook: ${p.name}
echo "Running postProvision hook for ${p.name}..."
${p.hooks!.postProvision}
echo "postProvision hook for ${p.name} complete"`)
    .join("\n");

  // Plugin preStart hooks
  const preStartHooksScript = (config.plugins ?? [])
    .filter((p) => p.hooks?.preStart)
    .map((p) => `
# preStart hook: ${p.name}
echo "Running preStart hook for ${p.name}..."
${p.hooks!.preStart}
echo "preStart hook for ${p.name} complete"`)
    .join("\n");

  // Clawhub skills
  const clawhubSkillsScript = (config.clawhubSkills ?? []).length > 0
    ? `
# Install public skills from clawhub
echo "Installing clawhub skills..."
${(config.clawhubSkills ?? []).map((slug) =>
  `clawhub install ${slug} || echo "WARNING: clawhub skill ${slug} install failed."`,
).join("\n")}
echo "Clawhub skills installation complete"`
    : "";

  // Workspace files injection
  const workspaceFilesScript = generateNixWorkspaceFilesScript(config.workspaceFiles);

  // Post-setup commands
  const postSetupScript = config.postSetupCommands
    ? config.postSetupCommands.join("\n")
    : "";

  return `#!/bin/bash
set -e

# ============================================
# OpenClaw Nix Agent Entrypoint
# Generated by clawup Pulumi component
# ============================================

echo "Starting OpenClaw Nix agent configuration..."

# Write openclaw.json
echo "Writing openclaw.json..."
mkdir -p ${HOME}/.openclaw
cat > ${HOME}/.openclaw/openclaw.json << 'OPENCLAW_CONFIG'
${config.openclawConfigJson}
OPENCLAW_CONFIG
echo "Created openclaw.json"

# Export provider environment variables
${providerExports}
${pluginSecretExports}
${depSecretExports}
${additionalEnvExports}
${gitIdentityScript}
${depPostInstallScript}
${codingAgentInstallScript}
${postProvisionHooksScript}
${workspaceFilesScript}
${pluginInstallScript}
${clawhubSkillsScript}
${preStartHooksScript}
${postSetupScript}

echo "============================================"
echo "OpenClaw Nix agent setup complete!"
echo "============================================"

# Start OpenClaw gateway in foreground (keeps container alive)
echo "Starting OpenClaw gateway in foreground..."
openclaw gateway &
GW_PID=$!

# Wait for gateway to create the pending pairing request, then approve it
sleep 3
if openclaw devices approve --latest --token "\${GATEWAY_TOKEN}" 2>/dev/null; then
  echo "Auto-approved gateway device pairing"
else
  echo "WARNING: Device pairing approval failed (may already be paired)"
fi

wait $GW_PID
`;
}

/**
 * Generates bash script to install a coding agent CLI in the Nix environment.
 * No NVM sourcing needed — Node.js and npm are on PATH via Nix.
 * No sudo needed — running as the openclaw user directly.
 */
function generateNixCodingAgentInstall(codingAgentName: string, model?: string): string {
  const strippedModel = model?.replace(/^[^/]+\//, "") ?? "claude-opus-4-6";

  switch (codingAgentName) {
    case "claude-code":
      return `
# Install Claude Code CLI
echo "Installing Claude Code..."
curl -fsSL https://claude.ai/install.sh | bash || echo "WARNING: Claude Code installation failed."
if command -v claude &>/dev/null || [ -x "${HOME}/.local/bin/claude" ]; then
  echo "Claude Code installed successfully"
else
  echo "WARNING: Claude Code not found after install"
fi

# Configure Claude Code default model
mkdir -p ${HOME}/.claude
echo '{"model":"${strippedModel}","fastMode":true}' > ${HOME}/.claude/settings.json
echo "Claude Code default model set to ${strippedModel} (fast mode)"`;

    case "codex":
      return `
# Install Codex CLI via npm (Node.js on PATH via Nix)
echo "Installing Codex CLI..."
npm install -g @openai/codex || echo "WARNING: Codex installation failed."
if command -v codex &>/dev/null; then
  echo "Codex CLI installed successfully"
else
  echo "WARNING: Codex CLI not found after install"
fi

# Configure Codex default model
mkdir -p ${HOME}/.codex
cat > ${HOME}/.codex/config.toml << CODEX_CONFIG
model = "${strippedModel}"
CODEX_CONFIG
echo "Codex default model set to ${strippedModel}"`;

    default:
      return "";
  }
}

/**
 * Generates bash script to inject workspace files for the Nix container.
 * Uses /home/openclaw/ paths instead of /home/ubuntu/.
 */
function generateNixWorkspaceFilesScript(
  workspaceFiles?: Record<string, string>,
): string {
  if (!workspaceFiles || Object.keys(workspaceFiles).length === 0) {
    return "";
  }

  const lines = [
    "",
    "# Inject workspace files",
    'echo "Injecting workspace files..."',
    `mkdir -p ${HOME}/.openclaw/workspace`,
  ];

  for (const [filePath, content] of Object.entries(workspaceFiles)) {
    // Validate path to prevent directory traversal
    const normalized = filePath.replace(/\\/g, "/");
    if (
      normalized.includes("..") ||
      normalized.startsWith("/") ||
      normalized.includes("\0")
    ) {
      throw new Error(
        `Invalid workspace file path: "${filePath}". Paths must be relative and cannot contain "..".`,
      );
    }

    const fullPath = `${HOME}/.openclaw/workspace/${filePath}`;
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

    // Gzip + base64 encode
    const compressed = zlib.gzipSync(Buffer.from(content, "utf-8")).toString("base64");
    lines.push(`mkdir -p "${dirPath}"`);
    lines.push(`echo "${compressed}" | base64 -d | gunzip > "${fullPath}"`);
  }

  lines.push('echo "Workspace files injected successfully"');

  return lines.join("\n");
}
