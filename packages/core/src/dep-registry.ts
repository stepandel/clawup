/**
 * Dep registry — defines how each agent dependency is installed and what secrets it needs.
 *
 * Similar to PLUGIN_REGISTRY but for system-level tools (gh, brave-search, etc.)
 * that agents need but that aren't OpenClaw plugins.
 */

export interface DepSecret {
  /** Environment variable name (e.g., "GITHUB_TOKEN") */
  envVar: string;
  /** Whether the secret is per-agent or shared globally */
  scope: "agent" | "global";
  /** SSH command to verify this secret is configured. Exit 0 = configured. */
  checkCommand: string;
}

export interface DepRegistryEntry {
  /** Human-readable name for display */
  displayName: string;
  /** Bash script to install the dep (runs as root in cloud-init). Empty string = no install needed. */
  installScript: string;
  /** Bash script to run after install for auth/config (runs as ubuntu user).
   *  Can reference ${ENV_VAR} placeholders. Empty string = no post-install. */
  postInstallScript: string;
  /** Secret env vars this dep needs. Key = config key suffix, value = env var details. */
  secrets: Record<string, DepSecret>;
}

export const DEP_REGISTRY: Record<string, DepRegistryEntry> = {
  gh: {
    displayName: "GitHub CLI",
    installScript: `
# Install GitHub CLI
echo "Installing GitHub CLI..."
type -p curl >/dev/null || apt-get install -y curl
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt-get update
apt-get install -y gh
echo "GitHub CLI installed: $(gh --version | head -n1)"
`,
    postInstallScript: `
if echo "\${GITHUB_TOKEN}" | gh auth login --with-token 2>&1; then
  gh auth setup-git
  echo "GitHub CLI authenticated successfully"
else
  echo "WARNING: GitHub CLI authentication failed"
  echo "   You can authenticate manually later with: gh auth login"
fi
`,
    secrets: {
      GithubToken: {
        envVar: "GITHUB_TOKEN",
        scope: "agent",
        checkCommand: "gh auth status 2>&1 | grep -qi 'logged in'",
      },
    },
  },
  "brave-search": {
    displayName: "Brave Search",
    installScript: "",      // config-only, no binary to install
    postInstallScript: "",  // config patching stays in config-generator.ts
    secrets: {
      BraveApiKey: {
        envVar: "BRAVE_API_KEY",
        scope: "global",
        checkCommand: `openclaw config get tools.web.search.apiKey 2>/dev/null | grep -qv '^$'`,
      },
    },
  },
};
