/**
 * Dep registry — defines how each agent dependency is installed and what secrets it needs.
 *
 * Similar to PLUGIN_REGISTRY but for system-level tools (gh, brave-search, etc.)
 * that agents need but that aren't OpenClaw plugins.
 *
 * Install scripts are empty — tools are baked into the NixOS image.
 * Post-install scripts handle auth/config and run as the `openclaw` user.
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
  /** Bash script to install the dep (empty — tools are baked into the NixOS image) */
  installScript: string;
  /** Bash script to run after install for auth/config (runs as openclaw user).
   *  Can reference ${ENV_VAR} placeholders. Empty string = no post-install. */
  postInstallScript: string;
  /** Secret env vars this dep needs. Key = config key suffix, value = env var details. */
  secrets: Record<string, DepSecret>;
}

export const DEP_REGISTRY: Record<string, DepRegistryEntry> = {
  gh: {
    displayName: "GitHub CLI",
    installScript: "",  // gh is baked into the NixOS image
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
        checkCommand: `python3 -c "import json,sys;c=json.load(open('/home/openclaw/.openclaw/openclaw.json'));sys.exit(0 if c.get('tools',{}).get('web',{}).get('search',{}).get('apiKey') else 1)"`,
      },
    },
  },
};
