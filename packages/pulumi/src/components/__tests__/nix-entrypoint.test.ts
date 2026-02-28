/**
 * Tests for the Nix entrypoint generator.
 *
 * Verifies that generateNixEntrypoint() produces a minimal bash script
 * for the pre-built NixOS Docker image — no apt-get, no NVM, no useradd,
 * no Docker, no Tailscale, no systemd.
 */

import { describe, it, expect } from "vitest";
import {
  generateNixEntrypoint,
  type NixEntrypointConfig,
} from "../nix-entrypoint";
import { interpolateCloudInit } from "../cloud-init";
import { generateFullOpenClawConfig, type PluginEntry } from "../config-generator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function buildProviderEnv(providerApiKeys: Record<string, string>): Record<string, string> {
  const providerEnv: Record<string, string> = {};
  for (const [providerKey, value] of Object.entries(providerApiKeys)) {
    if (providerKey === "anthropic" && value.startsWith("sk-ant-oat")) {
      providerEnv["CLAUDE_CODE_OAUTH_TOKEN"] = value;
    } else {
      providerEnv[PROVIDER_ENV_MAP[providerKey]] = value;
    }
  }
  return providerEnv;
}

function makeNixConfig(
  base: {
    providerApiKeys: Record<string, string>;
    gatewayToken: string;
    model?: string;
    codingAgent?: string;
    workspaceFiles?: Record<string, string>;
    plugins?: NixEntrypointConfig["plugins"];
    deps?: NixEntrypointConfig["deps"];
    envVars?: Record<string, string>;
    clawhubSkills?: string[];
    postSetupCommands?: string[];
  },
  extras?: {
    resolvedSecrets?: Record<string, string>;
    braveApiKey?: string;
    agentName?: string;
    agentEmoji?: string;
  },
): NixEntrypointConfig {
  const providerEnv = buildProviderEnv(base.providerApiKeys);

  const pluginEntries: PluginEntry[] = (base.plugins ?? []).map((p) => ({
    name: p.name,
    enabled: true,
    config: p.config ?? {},
    secretEnvVars: p.secretEnvVars,
    configPath: p.configPath,
    internalKeys: p.internalKeys,
    configTransforms: p.configTransforms,
  }));

  const openclawConfig = generateFullOpenClawConfig({
    gatewayToken: base.gatewayToken,
    model: base.model ?? "anthropic/claude-opus-4-6",
    codingAgent: base.codingAgent ?? "claude-code",
    plugins: pluginEntries,
    braveApiKey: extras?.braveApiKey,
    agentName: extras?.agentName ?? base.envVars?.AGENT_NAME,
    agentEmoji: extras?.agentEmoji ?? base.envVars?.AGENT_EMOJI,
    providerEnv,
    resolvedSecrets: extras?.resolvedSecrets,
  });

  return {
    openclawConfigJson: JSON.stringify(openclawConfig, null, 2),
    providerEnv,
    gatewayToken: base.gatewayToken,
    model: base.model ?? "anthropic/claude-opus-4-6",
    codingAgent: base.codingAgent ?? "claude-code",
    workspaceFiles: base.workspaceFiles,
    envVars: base.envVars,
    plugins: base.plugins,
    deps: base.deps,
    clawhubSkills: base.clawhubSkills,
    postSetupCommands: base.postSetupCommands,
  };
}

/**
 * Runs the full Nix pipeline: generateNixEntrypoint → interpolateCloudInit.
 */
function runNixPipeline(
  config: NixEntrypointConfig,
  secrets?: Record<string, string>,
): string {
  const raw = generateNixEntrypoint(config);

  const additionalSecrets: Record<string, string> = { ...secrets };
  for (const [envVar, value] of Object.entries(config.providerEnv ?? {})) {
    additionalSecrets[envVar] = value;
  }

  return interpolateCloudInit(raw, {
    tailscaleAuthKey: "not-used",
    gatewayToken: config.gatewayToken,
    additionalSecrets,
  });
}

/**
 * Extracts and parses the JSON from the OPENCLAW_CONFIG heredoc.
 */
function extractJsonConfig(script: string): Record<string, unknown> {
  const match = script.match(/cat > .*openclaw\.json << 'OPENCLAW_CONFIG'\n([\s\S]*?)\nOPENCLAW_CONFIG/);
  expect(match, "Expected OPENCLAW_CONFIG heredoc block").toBeTruthy();
  return JSON.parse(match![1]);
}

/**
 * Known runtime variables that legitimately appear as ${VAR} in the final script.
 */
const RUNTIME_VARS = new Set([
  "HOME",
  "MODEL",
  "BINARY_PATH",
  "GITHUB_TOKEN",
  "GW_PID",
]);

function expectNoLeakedPlaceholders(script: string): void {
  const placeholderPattern = /\$\{([A-Z][A-Z0-9_]*?)(?::-)?}/g;
  const leaked: string[] = [];
  let match;
  while ((match = placeholderPattern.exec(script)) !== null) {
    if (!RUNTIME_VARS.has(match[1])) {
      leaked.push(match[0]);
    }
  }
  expect(leaked, `Unsubstituted placeholders found: ${leaked.join(", ")}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANTHROPIC_NIX = makeNixConfig({
  providerApiKeys: { anthropic: "sk-ant-api03-test-key" },
  gatewayToken: "gw-token-secret",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: { "SOUL.md": "You are a helpful PM agent." },
});

const OPENAI_NIX = makeNixConfig({
  providerApiKeys: { openai: "sk-openai-test-key" },
  gatewayToken: "gw-token-openai",
  model: "openai/gpt-4o",
  codingAgent: "codex",
});

const OAUTH_NIX = makeNixConfig({
  providerApiKeys: { anthropic: "sk-ant-oat-test-oauth-token" },
  gatewayToken: "gw-token-oauth",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
});

// ---------------------------------------------------------------------------
// 1. Basic script structure
// ---------------------------------------------------------------------------

describe("nix entrypoint — basic structure", () => {
  it("produces a valid bash script with shebang and set -e", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toMatch(/^#!/);
    expect(script).toContain("#!/bin/bash");
    expect(script).toContain("set -e");
  });

  it("writes openclaw.json via OPENCLAW_CONFIG heredoc", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain("Writing openclaw.json");
    expect(script).toContain("OPENCLAW_CONFIG");
  });

  it("JSON config has valid gateway auth", () => {
    const script = runNixPipeline(ANTHROPIC_NIX);
    const config = extractJsonConfig(script);
    const gateway = config.gateway as any;
    expect(gateway.auth.mode).toBe("token");
    expect(gateway.auth.token).toBe("gw-token-secret");
  });

  it("JSON config has correct provider env vars", () => {
    const script = runNixPipeline(ANTHROPIC_NIX);
    const config = extractJsonConfig(script);
    const env = config.env as Record<string, string>;
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-test-key");
  });

  it("starts gateway in foreground with device pairing", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain("openclaw gateway &");
    expect(script).toContain("devices approve --latest");
    expect(script).toContain("wait $GW_PID");
  });
});

// ---------------------------------------------------------------------------
// 2. Eliminated cloud-init features (must NOT be present)
// ---------------------------------------------------------------------------

describe("nix entrypoint — eliminated provisioning", () => {
  it("does NOT contain apt-get", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).not.toContain("apt-get");
  });

  it("does NOT contain nvm", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script.toLowerCase()).not.toContain("nvm");
  });

  it("does NOT contain useradd", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).not.toContain("useradd");
  });

  it("does NOT contain docker install", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).not.toContain("get.docker.com");
    expect(script).not.toContain("Install Docker");
  });

  it("does NOT contain tailscale", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script.toLowerCase()).not.toContain("tailscale");
  });

  it("does NOT contain systemctl or systemd", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).not.toContain("systemctl");
    expect(script).not.toContain("loginctl");
    expect(script).not.toContain("openclaw daemon install");
  });

  it("does NOT contain sudo -u ubuntu", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).not.toContain("sudo -u ubuntu");
    expect(script).not.toContain("sudo -H -u ubuntu");
  });

  it("uses /home/openclaw/ paths (not /home/ubuntu/)", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain("/home/openclaw/");
    expect(script).not.toContain("/home/ubuntu/");
  });
});

// ---------------------------------------------------------------------------
// 3. Coding agent CLI installation
// ---------------------------------------------------------------------------

describe("nix entrypoint — coding agent install", () => {
  it("installs Claude Code CLI without NVM sourcing", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain("Installing Claude Code");
    expect(script).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(script).not.toContain("NVM_DIR");
    expect(script).not.toContain("nvm.sh");
  });

  it("configures Claude Code default model", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain("settings.json");
    expect(script).toContain("claude-opus-4-6");
  });

  it("installs Codex CLI via npm (no NVM)", () => {
    const script = generateNixEntrypoint(OPENAI_NIX);
    expect(script).toContain("Installing Codex CLI");
    expect(script).toContain("npm install -g @openai/codex");
    expect(script).not.toContain("NVM_DIR");
    expect(script).not.toContain("nvm.sh");
  });

  it("configures Codex default model", () => {
    const script = generateNixEntrypoint(OPENAI_NIX);
    expect(script).toContain("config.toml");
    expect(script).toContain("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// 4. Provider environment and secrets
// ---------------------------------------------------------------------------

describe("nix entrypoint — provider env and secrets", () => {
  it("exports Anthropic API key", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain('export ANTHROPIC_API_KEY=');
  });

  it("exports OpenAI API key for Codex", () => {
    const script = generateNixEntrypoint(OPENAI_NIX);
    expect(script).toContain('export OPENAI_API_KEY=');
  });

  it("uses CLAUDE_CODE_OAUTH_TOKEN for OAuth tokens", () => {
    const script = generateNixEntrypoint(OAUTH_NIX);
    expect(script).toContain('export CLAUDE_CODE_OAUTH_TOKEN=');
    expect(script).not.toContain('export ANTHROPIC_API_KEY=');
  });

  it("all placeholders replaced after interpolation", () => {
    const script = runNixPipeline(ANTHROPIC_NIX);
    expectNoLeakedPlaceholders(script);
  });

  it("all placeholders replaced for OpenAI deploy", () => {
    const script = runNixPipeline(OPENAI_NIX);
    expectNoLeakedPlaceholders(script);
  });

  it("special characters in secrets survive interpolation", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-with$pecial" },
      gatewayToken: "gw-token-special",
    });
    const script = runNixPipeline(config);
    expect(script).toContain("sk-ant-with$pecial");
  });
});

// ---------------------------------------------------------------------------
// 5. Workspace files
// ---------------------------------------------------------------------------

describe("nix entrypoint — workspace files", () => {
  it("injects workspace files via gzip+base64", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    expect(script).toContain("Injecting workspace files");
    expect(script).toContain("/home/openclaw/.openclaw/workspace/SOUL.md");
    expect(script).toContain("base64 -d | gunzip");
  });

  it("skips workspace section when no files provided", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
    });
    const script = generateNixEntrypoint(config);
    expect(script).not.toContain("Injecting workspace files");
  });

  it("rejects directory traversal in file paths", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      workspaceFiles: { "../../../etc/passwd": "evil" },
    });
    expect(() => generateNixEntrypoint(config)).toThrow("Invalid workspace file path");
  });
});

// ---------------------------------------------------------------------------
// 6. Plugins and deps
// ---------------------------------------------------------------------------

describe("nix entrypoint — plugins and deps", () => {
  it("installs plugins via openclaw plugins install", () => {
    const config = makeNixConfig(
      {
        providerApiKeys: { anthropic: "sk-ant-test" },
        gatewayToken: "gw-token",
        plugins: [
          {
            name: "openclaw-linear",
            installable: true,
            config: {},
            secretEnvVars: { apiKey: "LINEAR_API_KEY" },
          },
        ],
      },
      { resolvedSecrets: { LINEAR_API_KEY: "lin_test" } },
    );
    const script = generateNixEntrypoint(config);
    expect(script).toContain("openclaw plugins install openclaw-linear");
  });

  it("non-installable plugin skips install", () => {
    const config = makeNixConfig(
      {
        providerApiKeys: { anthropic: "sk-ant-test" },
        gatewayToken: "gw-token",
        plugins: [
          {
            name: "slack",
            installable: false,
            configPath: "channels",
            config: { teamId: "T123" },
            secretEnvVars: { botToken: "SLACK_BOT_TOKEN" },
          },
        ],
      },
      { resolvedSecrets: { SLACK_BOT_TOKEN: "xoxb-test" } },
    );
    const script = generateNixEntrypoint(config);
    expect(script).not.toContain("openclaw plugins install slack");
  });

  it("runs postProvision hooks", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      plugins: [
        {
          name: "test-plugin",
          installable: true,
          config: {},
          hooks: {
            postProvision: 'echo "POST_PROVISION_MARKER"',
          },
        },
      ],
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain("POST_PROVISION_MARKER");
    expect(script).toContain("postProvision hook for test-plugin");
  });

  it("runs preStart hooks", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      plugins: [
        {
          name: "test-plugin",
          installable: true,
          config: {},
          hooks: {
            preStart: 'echo "PRE_START_MARKER"',
          },
        },
      ],
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain("PRE_START_MARKER");
    expect(script).toContain("preStart hook for test-plugin");
  });

  it("runs dep post-install scripts (no install scripts)", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      deps: [
        {
          name: "gh",
          postInstallScript: '# MARKER_GH_POST_INSTALL\ngh auth login',
          secrets: { GithubToken: { envVar: "GITHUB_TOKEN" } },
        },
      ],
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain("MARKER_GH_POST_INSTALL");
    // Should NOT contain root-level install scripts (baked into image)
    expect(script).not.toContain("apt-get install");
  });

  it("installs clawhub skills", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      clawhubSkills: ["@clawup/review-pr", "@clawup/deploy"],
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain("clawhub install @clawup/review-pr");
    expect(script).toContain("clawhub install @clawup/deploy");
  });
});

// ---------------------------------------------------------------------------
// 7. Additional env vars and git identity
// ---------------------------------------------------------------------------

describe("nix entrypoint — env vars and git identity", () => {
  it("exports additional env vars", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      envVars: { AGENT_NAME: "Test Agent", CUSTOM_VAR: "custom-value" },
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain('export AGENT_NAME="Test Agent"');
    expect(script).toContain('export CUSTOM_VAR="custom-value"');
  });

  it("configures git identity when AGENT_NAME is set", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      envVars: { AGENT_NAME: "PM Agent" },
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain('git config --global user.name "PM Agent"');
    expect(script).toContain("@clawup.sh");
  });

  it("runs post-setup commands", () => {
    const config = makeNixConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      postSetupCommands: ["echo 'POST_SETUP_MARKER'"],
    });
    const script = generateNixEntrypoint(config);
    expect(script).toContain("POST_SETUP_MARKER");
  });
});

// ---------------------------------------------------------------------------
// 8. Script size comparison
// ---------------------------------------------------------------------------

describe("nix entrypoint — size", () => {
  it("generates a significantly smaller script than cloud-init would", () => {
    const script = generateNixEntrypoint(ANTHROPIC_NIX);
    const lines = script.split("\n").filter((l) => l.trim().length > 0);
    // The Nix entrypoint should be much smaller than cloud-init (~400 lines)
    // For a basic config it should be well under 100 non-empty lines
    expect(lines.length).toBeLessThan(100);
  });
});
