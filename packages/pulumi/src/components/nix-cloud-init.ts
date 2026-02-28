/**
 * NixOS cloud-init generator for OpenClaw agents on AWS and Hetzner.
 *
 * Generates a minimal (~80 line) cloud-init script for pre-built NixOS VM images.
 * The script runs as root (standard cloud-init) and uses `sudo -u openclaw` for
 * user-scoped operations.
 *
 * Eliminates all provisioning steps that are baked into the NixOS image:
 * - No apt-get / package installation
 * - No Docker installation (baked in via virtualisation.docker.enable)
 * - No NVM / Node.js installation (Node.js is on PATH via Nix)
 * - No user creation (openclaw user is baked into image)
 * - No loginctl enable-linger / systemd user session setup
 *
 * Includes (unlike the Docker Nix entrypoint):
 * - Tailscale setup (tailscale up --authkey ...)
 * - systemd service management (systemctl restart openclaw-gateway)
 * - Compression support (for Hetzner's 32KB user_data limit)
 */

import * as zlib from "zlib";
import { CODING_AGENT_REGISTRY } from "@clawup/core";
import type { PluginInstallConfig } from "./cloud-init";

export interface NixCloudInitConfig {
  /** Pre-built openclaw.json content (complete, with secrets resolved) */
  openclawConfigJson: string;
  /** OAuth-resolved provider env var map: { envVarName: value } */
  providerEnv?: Record<string, string>;
  /** Gateway authentication token */
  gatewayToken: string;
  /** Gateway port (default: 18789) */
  gatewayPort?: number;
  /** Coding agent CLI name (e.g., "claude-code", "codex") */
  codingAgent?: string;
  /** AI model string (e.g., "anthropic/claude-opus-4-6") */
  model?: string;
  /** Tailscale auth key for device registration */
  tailscaleAuthKey: string;
  /** Tailscale hostname (e.g., "dev-agent-pm") */
  tailscaleHostname: string;
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
  /** Enable Tailscale Funnel for HTTPS proxy */
  enableFunnel?: boolean;
}

const HOME = "/home/openclaw";

/**
 * Generates a cloud-init script for a NixOS-based OpenClaw VM.
 *
 * The script assumes:
 * - openclaw-gateway, Node.js, pnpm, git, gh, Docker, Tailscale are pre-installed
 * - Running as root (standard cloud-init), uses `sudo -u openclaw` for user commands
 * - systemd manages the openclaw-gateway service
 */
export function generateNixCloudInit(config: NixCloudInitConfig): string {
  const codingAgentName = config.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];
  const gatewayPort = config.gatewayPort ?? 18789;

  // Provider env var exports (written to .profile for the openclaw user)
  const providerProfileExports = Object.entries(config.providerEnv ?? {})
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

  // Git identity configuration (runs as openclaw user)
  const gitIdentityScript = config.envVars?.AGENT_NAME
    ? `
# Configure git identity for coding agent commits
sudo -u openclaw git config --global user.name "${config.envVars.AGENT_NAME}"
sudo -u openclaw git config --global user.email "${config.envVars.AGENT_NAME.toLowerCase().replace(/[^a-z0-9]/g, "")}@clawup.sh"
echo "Configured git identity: ${config.envVars.AGENT_NAME}"`
    : "";

  // Coding agent CLI install (uses sudo -u openclaw, no NVM)
  const codingAgentInstallScript = codingAgentEntry
    ? generateNixVmCodingAgentInstall(codingAgentName, config.model)
    : "";

  // Dep post-install scripts (run as openclaw user)
  const depPostInstallScript = (config.deps ?? [])
    .filter((d) => d.postInstallScript)
    .map((d) => `
# Post-install: ${d.name}
sudo -u openclaw bash -c '${d.postInstallScript.replace(/'/g, "'\\''")}'`)
    .join("\n");

  // Plugin install steps (run as openclaw user)
  const installablePlugins = (config.plugins ?? []).filter((p) => p.installable !== false);
  const pluginInstallScript = installablePlugins.length > 0
    ? `
# Install OpenClaw plugins
echo "Installing plugins..."
${installablePlugins.map((p) =>
  `sudo -u openclaw openclaw plugins install ${p.name} || echo "WARNING: ${p.name} plugin install failed."`,
).join("\n")}
echo "Plugin installation complete"`
    : "";

  // Plugin postProvision hooks (run as openclaw user)
  const postProvisionHooksScript = (config.plugins ?? [])
    .filter((p) => p.hooks?.postProvision)
    .map((p) => `
# postProvision hook: ${p.name}
echo "Running postProvision hook for ${p.name}..."
sudo -u openclaw bash -c '${p.hooks!.postProvision!.replace(/'/g, "'\\''")}'
echo "postProvision hook for ${p.name} complete"`)
    .join("\n");

  // Plugin preStart hooks (run as openclaw user)
  const preStartHooksScript = (config.plugins ?? [])
    .filter((p) => p.hooks?.preStart)
    .map((p) => `
# preStart hook: ${p.name}
echo "Running preStart hook for ${p.name}..."
sudo -u openclaw bash -c '${p.hooks!.preStart!.replace(/'/g, "'\\''")}'
echo "preStart hook for ${p.name} complete"`)
    .join("\n");

  // Clawhub skills (run as openclaw user)
  const clawhubSkillsScript = (config.clawhubSkills ?? []).length > 0
    ? `
# Install public skills from clawhub
echo "Installing clawhub skills..."
${(config.clawhubSkills ?? []).map((slug) =>
  `sudo -u openclaw clawhub install ${slug} || echo "WARNING: clawhub skill ${slug} install failed."`,
).join("\n")}
echo "Clawhub skills installation complete"`
    : "";

  // Workspace files injection
  const workspaceFilesScript = generateNixVmWorkspaceFilesScript(config.workspaceFiles);

  // Post-setup commands
  const postSetupScript = config.postSetupCommands
    ? config.postSetupCommands.join("\n")
    : "";

  // Tailscale serve/funnel for HTTPS proxy
  const tailscaleFunnelScript = config.enableFunnel
    ? `
# Enable Tailscale Funnel for HTTPS proxy
tailscale funnel --bg ${gatewayPort}
echo "Tailscale Funnel enabled on port ${gatewayPort}"`
    : `
# Enable Tailscale HTTPS proxy (serve mode)
tailscale serve --bg ${gatewayPort}
echo "Tailscale serve enabled on port ${gatewayPort}"`;

  return `#!/bin/bash
set -e

# ============================================
# OpenClaw NixOS Cloud-Init
# Generated by clawup Pulumi component
# ============================================

echo "Starting OpenClaw NixOS agent configuration..."

# Write openclaw.json
echo "Writing openclaw.json..."
mkdir -p ${HOME}/.openclaw
cat > ${HOME}/.openclaw/openclaw.json << 'OPENCLAW_CONFIG'
${config.openclawConfigJson}
OPENCLAW_CONFIG
chown openclaw:openclaw ${HOME}/.openclaw/openclaw.json
echo "Created openclaw.json"

# Write provider environment variables to .profile
cat >> ${HOME}/.profile << 'PROFILE_ENV'
${providerProfileExports}
${pluginSecretExports}
${depSecretExports}
${additionalEnvExports}
PROFILE_ENV
chown openclaw:openclaw ${HOME}/.profile
${gitIdentityScript}
${depPostInstallScript}
${codingAgentInstallScript}
${postProvisionHooksScript}
${workspaceFilesScript}
${pluginInstallScript}
${clawhubSkillsScript}
${preStartHooksScript}
${postSetupScript}

# Configure and start Tailscale
echo "Starting Tailscale..."
tailscale up --authkey="\${TAILSCALE_AUTH_KEY}" --ssh --hostname=${config.tailscaleHostname}
echo "Tailscale connected as ${config.tailscaleHostname}"
${tailscaleFunnelScript}

# Restart openclaw-gateway via systemd
echo "Restarting openclaw-gateway service..."
systemctl restart openclaw-gateway
echo "openclaw-gateway service restarted"

echo "============================================"
echo "OpenClaw NixOS agent setup complete!"
echo "============================================"

# Wait for gateway to create the pending pairing request, then approve it
sleep 3
if sudo -u openclaw openclaw devices approve --latest --token "\${GATEWAY_TOKEN}" 2>/dev/null; then
  echo "Auto-approved gateway device pairing"
else
  echo "WARNING: Device pairing approval failed (may already be paired)"
fi
`;
}

/**
 * Compresses a NixOS cloud-init script using gzip + base64 MIME encoding.
 * Required for Hetzner's 32KB user_data limit.
 */
export function compressNixCloudInit(script: string): string {
  const gzipped = zlib.gzipSync(Buffer.from(script, "utf-8"));
  const encoded = gzipped.toString("base64");
  return `Content-Type: multipart/mixed; boundary="MIMEBOUNDARY"
MIME-Version: 1.0

--MIMEBOUNDARY
Content-Type: text/x-shellscript; charset="utf-8"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="cloud-init.sh"

${encoded}
--MIMEBOUNDARY--
`;
}

/**
 * Generates bash script to install a coding agent CLI in the NixOS VM.
 * Uses `sudo -u openclaw` — Node.js and npm are on PATH via Nix (no NVM).
 */
function generateNixVmCodingAgentInstall(codingAgentName: string, model?: string): string {
  const strippedModel = model?.replace(/^[^/]+\//, "") ?? "claude-opus-4-6";

  switch (codingAgentName) {
    case "claude-code":
      return `
# Install Claude Code CLI
echo "Installing Claude Code..."
sudo -u openclaw bash -c 'curl -fsSL https://claude.ai/install.sh | bash' || echo "WARNING: Claude Code installation failed."
if sudo -u openclaw bash -c 'command -v claude &>/dev/null || [ -x "${HOME}/.local/bin/claude" ]'; then
  echo "Claude Code installed successfully"
else
  echo "WARNING: Claude Code not found after install"
fi

# Configure Claude Code default model
sudo -u openclaw mkdir -p ${HOME}/.claude
sudo -u openclaw bash -c 'echo '"'"'{"model":"${strippedModel}","fastMode":true}'"'"' > ${HOME}/.claude/settings.json'
echo "Claude Code default model set to ${strippedModel} (fast mode)"`;

    case "codex":
      return `
# Install Codex CLI via npm (Node.js on PATH via Nix)
echo "Installing Codex CLI..."
sudo -u openclaw npm install -g @openai/codex || echo "WARNING: Codex installation failed."
if sudo -u openclaw bash -c 'command -v codex &>/dev/null'; then
  echo "Codex CLI installed successfully"
else
  echo "WARNING: Codex CLI not found after install"
fi

# Configure Codex default model
sudo -u openclaw mkdir -p ${HOME}/.codex
sudo -u openclaw bash -c 'cat > ${HOME}/.codex/config.toml << CODEX_CONFIG
model = "${strippedModel}"
CODEX_CONFIG'
echo "Codex default model set to ${strippedModel}"`;

    default:
      return "";
  }
}

/**
 * Generates bash script to inject workspace files for the NixOS VM.
 * Uses /home/openclaw/ paths and chowns files to the openclaw user.
 */
function generateNixVmWorkspaceFilesScript(
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

  lines.push(`chown -R openclaw:openclaw ${HOME}/.openclaw/workspace`);
  lines.push('echo "Workspace files injected successfully"');

  return lines.join("\n");
}
