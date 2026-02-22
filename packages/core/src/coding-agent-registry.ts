/**
 * Coding agent registry — defines how each coding agent CLI is installed and configured.
 *
 * Similar to DEP_REGISTRY but for coding agent CLIs (Claude Code, Codex, Amp, etc.)
 * that OpenClaw uses as its backend for AI-assisted coding sessions.
 */

export interface CodingAgentEntry {
  /** Human-readable display name */
  displayName: string;
  /** Bash script to install the coding agent CLI (runs as ubuntu user via sudo) */
  installScript: string;
  /**
   * Bash script to configure the agent's default model.
   * Receives ${MODEL} variable with the stripped model name (e.g., "claude-opus-4-6").
   */
  configureModelScript: string;
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
    installScript: `
# Install Claude Code CLI for ubuntu user
echo "Installing Claude Code..."
sudo -u ubuntu bash << 'CLAUDE_CODE_INSTALL_SCRIPT' || echo "WARNING: Claude Code installation failed. Install manually with: curl -fsSL https://claude.ai/install.sh | bash"
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
sudo -u ubuntu bash -c '
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
};
