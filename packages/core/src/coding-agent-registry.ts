/**
 * Coding agent registry — defines how each coding agent CLI is installed and configured.
 *
 * Similar to DEP_REGISTRY but for coding agent CLIs (Claude Code, Codex, Amp, etc.)
 * that OpenClaw uses as its backend for AI-assisted coding sessions.
 *
 * Install scripts run as the `openclaw` user. Node.js is on PATH via Nix (no NVM).
 */

export interface CodingAgentSecret {
  /** Environment variable name (e.g., "ANTHROPIC_API_KEY") */
  envVar: string;
  /** Whether the secret is per-agent or shared globally */
  scope: "agent" | "global";
}

export interface CodingAgentEntry {
  /** Human-readable display name */
  displayName: string;
  /** Bash script to install the coding agent CLI (runs as openclaw user) */
  installScript: string;
  /**
   * Bash script to configure the agent's default model.
   * Receives ${MODEL} variable with the stripped model name (e.g., "claude-opus-4-6").
   */
  configureModelScript: string;
  /** Secret env vars this coding agent needs. Key = config key suffix, value = env var details. */
  secrets: Record<string, CodingAgentSecret>;
  /** OpenClaw cliBackends entry for openclaw.json */
  cliBackend: {
    command: string;
    args: string[];
    output: string;
    modelArg: string;
    sessionArg: string;
    sessionMode: string;
    systemPromptArg: string;
    systemPromptWhen: string;
    imageArg?: string;
    imageMode?: string;
  };
}

export const CODING_AGENT_REGISTRY: Record<string, CodingAgentEntry> = {
  "claude-code": {
    displayName: "Claude Code",
    secrets: {
      AnthropicApiKey: { envVar: "ANTHROPIC_API_KEY", scope: "agent" },
      ClaudeCodeOAuthToken: { envVar: "CLAUDE_CODE_OAUTH_TOKEN", scope: "agent" },
    },
    installScript: `
# Install Claude Code CLI
echo "Installing Claude Code..."
sudo -u openclaw bash << 'CLAUDE_CODE_INSTALL_SCRIPT' || echo "WARNING: Claude Code installation failed. Install manually with: curl -fsSL https://claude.ai/install.sh | bash"
set -e
cd ~

# Install Claude Code via official installer
curl -fsSL https://claude.ai/install.sh | bash

# Add .local/bin to PATH in .bashrc if not already there
if ! grep -q '.local/bin' ~/.bashrc; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
fi

# Verify installation
BINARY_PATH="$HOME/.local/bin/claude"
if [ -x "$BINARY_PATH" ] || command -v claude &>/dev/null; then
  echo "Claude Code installed successfully"
else
  echo "WARNING: Claude Code installation may have failed"
  exit 1
fi
CLAUDE_CODE_INSTALL_SCRIPT`.trim(),
    configureModelScript: `
# Configure Claude Code default model
sudo -u openclaw bash -c '
mkdir -p ~/.claude
echo '"'"'{"model":"\${MODEL}","fastMode":true}'"'"' > ~/.claude/settings.json
echo "Claude Code default model set to \${MODEL} (fast mode)"
'`.trim(),
    cliBackend: {
      command: "claude",
      args: ["-p", "--output-format", "stream-json", "--verbose"],
      output: "jsonl",
      modelArg: "--model",
      sessionArg: "--resume",
      sessionMode: "always",
      systemPromptArg: "--append-system-prompt",
      systemPromptWhen: "always",
    },
  },
  codex: {
    displayName: "Codex (OpenAI)",
    installScript: `
# Install Codex CLI
echo "Installing Codex CLI..."
sudo -u openclaw bash << 'CODEX_INSTALL_SCRIPT' || echo "WARNING: Codex installation failed. Install manually with: npm install -g @openai/codex"
set -e
cd ~

# Install Codex via npm (Node.js on PATH via Nix)
npm install -g @openai/codex

# Symlink to .local/bin for PATH consistency
mkdir -p "$HOME/.local/bin"
CODEX_BIN=$(command -v codex 2>/dev/null || true)
if [ -n "$CODEX_BIN" ]; then
  ln -sf "$CODEX_BIN" "$HOME/.local/bin/codex"
  echo "Codex CLI installed successfully"
else
  echo "WARNING: Codex CLI installation may have failed"
  exit 1
fi
CODEX_INSTALL_SCRIPT`.trim(),
    configureModelScript: `
# Configure Codex default model
sudo -u openclaw bash -c '
mkdir -p ~/.codex
cat > ~/.codex/config.toml << CODEX_CONFIG
model = "\${MODEL}"
CODEX_CONFIG
echo "Codex default model set to \${MODEL}"
'`.trim(),
    secrets: {
      OpenaiApiKey: { envVar: "OPENAI_API_KEY", scope: "agent" },
    },
    cliBackend: {
      command: "codex",
      args: ["exec", "--full-auto"],
      output: "text",
      modelArg: "--model",
      sessionArg: "",
      sessionMode: "never",
      systemPromptArg: "",
      systemPromptWhen: "never",
    },
  },
};
