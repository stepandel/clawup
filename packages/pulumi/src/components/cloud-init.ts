/**
 * Cloud-init script generator for OpenClaw agents
 * Generates the user-data script for EC2 instance provisioning
 */

import * as zlib from "zlib";
import { generateConfigPatchScript, PluginEntry } from "./config-generator";
import { CODING_AGENT_REGISTRY, type CodingAgentEntry } from "@clawup/core";

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
  deps?: { name: string; installScript: string; postInstallScript: string; secrets: Record<string, { envVar: string }> }[];
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
export function generateCloudInit(config: CloudInitConfig): string {
  const gatewayPort = config.gatewayPort ?? 18789;
  const nodeVersion = config.nodeVersion ?? 22;
  const nvmVersion = config.nvmVersion ?? "0.40.1";
  const openclawVersion = config.openclawVersion ?? "latest";
  const trustedProxies = config.trustedProxies ?? ["127.0.0.1"];

  // Build PluginEntry[] for config-generator from PluginInstallConfig[]
  const pluginEntries: PluginEntry[] = (config.plugins ?? []).map((p) => ({
    name: p.name,
    enabled: true,
    config: p.config ?? {},
    secretEnvVars: p.secretEnvVars,
  }));

  // Extract braveApiKey from depSecrets for config-generator (special case)
  const braveApiKey = config.depSecrets?.["BRAVE_API_KEY"];

  const codingAgentName = config.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];

  const configPatchScript = generateConfigPatchScript({
    gatewayPort,
    gatewayToken: config.gatewayToken,
    trustedProxies,
    enableControlUi: true,
    plugins: pluginEntries,
    braveApiKey: braveApiKey,
    backupModel: config.backupModel,
    codingAgent: codingAgentName,
  });

  // Dynamic dep installation scripts (runs as root)
  const depInstallScript = (config.deps ?? [])
    .filter(d => d.installScript)
    .map(d => d.installScript)
    .join("\n");

  // Dynamic dep post-install scripts (runs as ubuntu user)
  const depPostInstallScript = (config.deps ?? [])
    .filter(d => d.postInstallScript)
    .map(d => `
# Post-install: ${d.name}
sudo -u ubuntu bash << 'DEP_POST_INSTALL'
${d.postInstallScript}
DEP_POST_INSTALL
`)
    .join("\n");

  // Coding agent CLI installation script (registry-driven)
  const codingClisInstallScript = codingAgentEntry
    ? generateCodingAgentInstallScript(codingAgentEntry, config.model)
    : "";

  // Dynamic plugin install steps (only for installable plugins)
  const installablePlugins = (config.plugins ?? []).filter((p) => p.installable !== false);
  const pluginInstallScript = installablePlugins.length > 0
    ? `
# Install OpenClaw plugins
echo "Installing plugins..."
sudo -H -u ubuntu bash -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

${installablePlugins.map((p) =>
  `openclaw plugins install ${p.name} || echo "WARNING: ${p.name} plugin install failed. Install manually with: openclaw plugins install ${p.name}"`
).join("\n")}
'
echo "Plugin installation complete"
`
    : "";

  // Dynamic clawhub skill install steps
  const clawhubSkillsScript = (config.clawhubSkills ?? []).length > 0
    ? `
# Install public skills from clawhub
echo "Installing clawhub skills..."
sudo -H -u ubuntu bash -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

${(config.clawhubSkills ?? []).map((slug) =>
  `clawhub install ${slug} || echo "WARNING: clawhub skill ${slug} install failed."`,
).join("\n")}
'
echo "Clawhub skills installation complete"
`
    : "";

  // Generate workspace files injection script
  const workspaceFilesScript = generateWorkspaceFilesScript(config.workspaceFiles);

  // Generate additional env vars
  const additionalEnvVars = config.envVars
    ? Object.entries(config.envVars)
        .map(([key, value]) => `echo 'export ${key}="${value}"' >> /home/ubuntu/.bashrc`)
        .join("\n")
    : "";

  // Generate post-setup commands
  const postSetupScript = config.postSetupCommands
    ? config.postSetupCommands.join("\n")
    : "";

  // Create ubuntu user section (for Hetzner / local Docker)
  const createUserSection = config.createUbuntuUser
    ? config.skipDocker
      ? `
# Create ubuntu user (local Docker — no docker group)
useradd -m -s /bin/bash ubuntu || true
`
      : `
# Create ubuntu user (Hetzner uses root by default)
useradd -m -s /bin/bash -G docker ubuntu || true
`
    : "";

  // Tailscale installation section
  const tailscaleSection = config.skipTailscale
    ? ""
    : `
# Install and configure Tailscale
echo "Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="\${TAILSCALE_AUTH_KEY}" --ssh${config.tailscaleHostname ? ` --hostname=${config.tailscaleHostname}` : ""} || echo "WARNING: Tailscale setup failed. Run 'sudo tailscale up' manually."
`;

  // Tailscale proxy section: funnel (public access for webhooks) or serve (Tailscale-only HTTPS)
  const tailscaleProxySection = config.skipTailscale
    ? ""
    : config.enableFunnel
      ? `
# Enable Tailscale Funnel for webhook endpoint (public HTTPS)
echo "Enabling Tailscale Funnel for webhook endpoint..."
if tailscale funnel --bg ${gatewayPort}; then
  echo "Tailscale Funnel enabled — webhook endpoint is publicly accessible"
else
  echo "WARNING: tailscale funnel failed — falling back to tailscale serve (webhooks will NOT work until Funnel is enabled in Tailscale admin)"
  tailscale serve --bg ${gatewayPort} || echo "WARNING: tailscale serve also failed. Enable HTTPS in your Tailscale admin console."
fi
`
      : `
# Enable Tailscale HTTPS proxy (requires HTTPS to be enabled in Tailscale admin console)
echo "Enabling Tailscale HTTPS proxy..."
tailscale serve --bg ${gatewayPort} || echo "WARNING: tailscale serve failed. Enable HTTPS in your Tailscale admin console first."
`;

  // Collect all secret env vars that need to be passed to the config-patch python script
  const pluginSecretEnvVarExports: string[] = [];
  for (const plugin of config.plugins ?? []) {
    for (const envVar of Object.values(plugin.secretEnvVars ?? {})) {
      pluginSecretEnvVarExports.push(`  ${envVar}="\${${envVar}:-}"`);
    }
  }
  const pluginSecretEnvLine = pluginSecretEnvVarExports.length > 0
    ? ` \\\n${pluginSecretEnvVarExports.join(" \\\n")}`
    : "";

  return `#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive

# ============================================
# OpenClaw Agent Provisioning Script
# Generated by clawup Pulumi component
# ============================================

# Configuration
ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY}"
TAILSCALE_AUTH_KEY="\${TAILSCALE_AUTH_KEY}"
GATEWAY_TOKEN="\${GATEWAY_TOKEN}"
GATEWAY_PORT="${gatewayPort}"
NODE_VERSION="${nodeVersion}"
NVM_VERSION="${nvmVersion}"
OPENCLAW_VERSION="${openclawVersion}"

echo "Starting OpenClaw agent provisioning..."

# System updates
echo "Updating system packages..."
apt-get update
apt-get upgrade -y
apt-get install -y unzip build-essential sudo

${config.skipDocker ? "" : `# Install Docker
echo "Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker`}
${createUserSection}
${config.skipDocker ? "" : "usermod -aG docker ubuntu"}
${tailscaleSection}
${depInstallScript}

# Install NVM and Node.js for ubuntu user
echo "Installing Node.js $NODE_VERSION via NVM..."
sudo -u ubuntu bash << 'UBUNTU_SCRIPT'
set -e
cd ~

# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v${nvmVersion}/install.sh | bash

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install Node.js
nvm install ${nodeVersion}
nvm use ${nodeVersion}
nvm alias default ${nodeVersion}

# Install OpenClaw
npm install -g openclaw@${openclawVersion}

# Add NVM to bashrc if not already there
if ! grep -q 'NVM_DIR' ~/.bashrc; then
  echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
  echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> ~/.bashrc
fi
UBUNTU_SCRIPT

# Set environment variables for ubuntu user
# Auto-detect credential type and export the correct variable
if [[ "\${ANTHROPIC_API_KEY}" =~ ^sk-ant-oat ]]; then
  # OAuth token from Claude Pro/Max subscription
  echo 'export CLAUDE_CODE_OAUTH_TOKEN="\${ANTHROPIC_API_KEY}"' >> /home/ubuntu/.bashrc
  echo "Detected OAuth token, exporting as CLAUDE_CODE_OAUTH_TOKEN"
else
  # API key from Anthropic Console
  echo 'export ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY}"' >> /home/ubuntu/.bashrc
  echo "Detected API key, exporting as ANTHROPIC_API_KEY"
fi
${(config.plugins ?? [])
    .flatMap((p) => Object.values(p.secretEnvVars ?? {}))
    .map((envVar) => `[ -n "\${${envVar}:-}" ] && echo 'export ${envVar}="\${${envVar}:-}"' >> /home/ubuntu/.bashrc`)
    .join("\n")}
${(config.deps ?? [])
    .flatMap(d => Object.values(d.secrets).map(s => s.envVar))
    .map(envVar => `[ -n "\${${envVar}:-}" ] && echo 'export ${envVar}="\${${envVar}:-}"' >> /home/ubuntu/.bashrc`)
    .join("\n")}
${additionalEnvVars}
${depPostInstallScript}
${codingClisInstallScript}

${config.foregroundMode ? "" : `# Enable systemd linger for ubuntu user (required for user services to run at boot)
loginctl enable-linger ubuntu

# Start user's systemd instance (required for user services during cloud-init)
systemctl start user@1000.service`}

# Run OpenClaw onboarding as ubuntu user (skip daemon install, do it separately)
echo "Running OpenClaw onboarding..."
sudo -H -u ubuntu ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY}" GATEWAY_PORT="$GATEWAY_PORT" bash -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

openclaw onboard --non-interactive --accept-risk \\
  --mode local \\
  --auth-choice apiKey \\
  --gateway-port $GATEWAY_PORT \\
  --gateway-bind loopback \\
  --skip-daemon \\
  --skip-skills || echo "WARNING: OpenClaw onboarding failed. Run openclaw onboard manually."
'
${workspaceFilesScript}
${pluginInstallScript}
${clawhubSkillsScript}
# Configure gateway for Tailscale Serve (BEFORE daemon install so token matches)
echo "Configuring OpenClaw gateway..."
sudo -H -u ubuntu \\
  GATEWAY_TOKEN="\${GATEWAY_TOKEN}" \\
  ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY}" \\
  BRAVE_API_KEY="${braveApiKey ?? ""}" \\
  AGENT_NAME="${config.envVars?.AGENT_NAME ?? ""}" \\
  AGENT_EMOJI="${config.envVars?.AGENT_EMOJI ?? ""}"${pluginSecretEnvLine} \\
  python3 << 'PYTHON_SCRIPT'
${configPatchScript}
PYTHON_SCRIPT
${tailscaleProxySection}
${config.foregroundMode ? `# Run openclaw doctor before starting daemon in foreground
echo "Running openclaw doctor..."
sudo -H -u ubuntu bash -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
openclaw doctor --fix --non-interactive || echo "WARNING: openclaw doctor failed"
'

${postSetupScript}
echo "============================================"
echo "OpenClaw agent setup complete!"
echo "============================================"

# Start OpenClaw daemon in foreground (keeps container alive)
echo "Starting OpenClaw daemon in foreground..."
exec su - ubuntu -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
exec openclaw daemon start
'` : `# Install daemon service AFTER config patch so gateway token matches
echo "Installing OpenClaw daemon..."
sudo -H -u ubuntu XDG_RUNTIME_DIR=/run/user/1000 bash -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

openclaw daemon install || echo "WARNING: Daemon install failed. Run openclaw daemon install manually."
'

# Run openclaw doctor to fix any remaining config issues
echo "Running openclaw doctor..."
sudo -H -u ubuntu bash -c '
export HOME=/home/ubuntu
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
openclaw doctor --fix --non-interactive || echo "WARNING: openclaw doctor failed"
'

${postSetupScript}
echo "============================================"
echo "OpenClaw agent setup complete!"
echo "============================================"`}
`;
}

/**
 * Generates bash script to inject workspace files
 */
function generateWorkspaceFilesScript(
  workspaceFiles?: Record<string, string>
): string {
  if (!workspaceFiles || Object.keys(workspaceFiles).length === 0) {
    return "";
  }

  const lines = [
    "",
    "# Inject workspace files",
    'echo "Injecting workspace files..."',
    "mkdir -p /home/ubuntu/.openclaw/workspace",
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
        `Invalid workspace file path: "${filePath}". Paths must be relative and cannot contain "..".`
      );
    }

    const fullPath = `/home/ubuntu/.openclaw/workspace/${filePath}`;
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

    // Gzip + base64 encode to stay within Hetzner's 32KB user_data limit
    const compressed = zlib.gzipSync(Buffer.from(content, "utf-8")).toString("base64");
    lines.push(`mkdir -p "${dirPath}"`);
    lines.push(`echo "${compressed}" | base64 -d | gunzip > "${fullPath}"`);
  }

  lines.push('chown -R ubuntu:ubuntu /home/ubuntu/.openclaw/workspace');
  lines.push('echo "Workspace files injected successfully"');

  return lines.join("\n");
}

/**
 * Interpolates environment variables in the cloud-init script.
 * Call this with actual values before passing to EC2 user data.
 *
 * Base secrets (anthropic, tailscale, gateway, slack, github, brave) are always handled.
 * Plugin secrets are passed via the additionalSecrets map.
 */
export function interpolateCloudInit(
  script: string,
  values: {
    anthropicApiKey: string;
    tailscaleAuthKey: string;
    gatewayToken: string;
    /** Additional secret env vars from plugins and deps: { envVarName: value } */
    additionalSecrets?: Record<string, string>;
  }
): string {
  let result = script
    .replace(/\${ANTHROPIC_API_KEY}/g, values.anthropicApiKey)
    .replace(/\${TAILSCALE_AUTH_KEY}/g, values.tailscaleAuthKey)
    .replace(/\${GATEWAY_TOKEN}/g, values.gatewayToken);

  // Plugin and dep secret env vars (includes Slack tokens, Linear keys, GitHub token, etc.)
  if (values.additionalSecrets) {
    for (const [envVar, value] of Object.entries(values.additionalSecrets)) {
      const escaped = value.replace(/\$/g, "$$$$");
      result = result.replace(new RegExp(`\\$\\{${envVar}:-\\}`, "g"), escaped);
      result = result.replace(new RegExp(`\\$\\{${envVar}\\}`, "g"), escaped);
    }
  }

  return result;
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

/**
 * Generates bash script to install a coding agent CLI and configure its default model.
 * Uses the registry entry's installScript and configureModelScript.
 */
function generateCodingAgentInstallScript(entry: CodingAgentEntry, model?: string): string {
  // Strip provider prefix (e.g. "anthropic/claude-opus-4-6" -> "claude-opus-4-6")
  const strippedModel = model?.replace(/^[^/]+\//, "") ?? "claude-opus-4-6";

  // Replace ${MODEL} placeholder in configureModelScript
  const configScript = entry.configureModelScript.replace(/\$\{MODEL\}/g, strippedModel);

  return `
${entry.installScript}

${configScript}
`;
}
