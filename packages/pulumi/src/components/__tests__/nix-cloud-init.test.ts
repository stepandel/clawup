/**
 * Tests for the NixOS cloud-init generator.
 *
 * Verifies that generateNixCloudInit() produces a minimal bash script
 * for pre-built NixOS VM images — no apt-get, no NVM, no useradd,
 * no Docker install, but WITH Tailscale and systemctl.
 */

import { describe, it, expect } from "vitest";
import {
  generateNixCloudInit,
  compressNixCloudInit,
  type NixCloudInitConfig,
} from "../nix-cloud-init";
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

function makeNixCloudInitConfig(
  base: {
    providerApiKeys: Record<string, string>;
    gatewayToken: string;
    tailscaleAuthKey?: string;
    tailscaleHostname?: string;
    model?: string;
    codingAgent?: string;
    workspaceFiles?: Record<string, string>;
    plugins?: NixCloudInitConfig["plugins"];
    deps?: NixCloudInitConfig["deps"];
    envVars?: Record<string, string>;
    clawhubSkills?: string[];
    postSetupCommands?: string[];
    enableFunnel?: boolean;
    gatewayPort?: number;
  },
  extras?: {
    resolvedSecrets?: Record<string, string>;
    braveApiKey?: string;
    agentName?: string;
    agentEmoji?: string;
  },
): NixCloudInitConfig {
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
    gatewayPort: base.gatewayPort,
    model: base.model ?? "anthropic/claude-opus-4-6",
    codingAgent: base.codingAgent ?? "claude-code",
    tailscaleAuthKey: base.tailscaleAuthKey ?? "tskey-auth-test-key",
    tailscaleHostname: base.tailscaleHostname ?? "dev-agent-test",
    workspaceFiles: base.workspaceFiles,
    envVars: base.envVars,
    plugins: base.plugins,
    deps: base.deps,
    clawhubSkills: base.clawhubSkills,
    postSetupCommands: base.postSetupCommands,
    enableFunnel: base.enableFunnel,
  };
}

/**
 * Runs the full NixOS cloud-init pipeline: generateNixCloudInit → interpolateCloudInit.
 */
function runNixCloudInitPipeline(
  config: NixCloudInitConfig,
  secrets?: Record<string, string>,
): string {
  const raw = generateNixCloudInit(config);

  const additionalSecrets: Record<string, string> = { ...secrets };
  for (const [envVar, value] of Object.entries(config.providerEnv ?? {})) {
    additionalSecrets[envVar] = value;
  }

  return interpolateCloudInit(raw, {
    tailscaleAuthKey: config.tailscaleAuthKey,
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

const ANTHROPIC_NIX_VM = makeNixCloudInitConfig({
  providerApiKeys: { anthropic: "sk-ant-api03-test-key" },
  gatewayToken: "gw-token-secret",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: { "SOUL.md": "You are a helpful PM agent." },
});

const OPENAI_NIX_VM = makeNixCloudInitConfig({
  providerApiKeys: { openai: "sk-openai-test-key" },
  gatewayToken: "gw-token-openai",
  model: "openai/gpt-4o",
  codingAgent: "codex",
});

const OAUTH_NIX_VM = makeNixCloudInitConfig({
  providerApiKeys: { anthropic: "sk-ant-oat-test-oauth-token" },
  gatewayToken: "gw-token-oauth",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
});

// ---------------------------------------------------------------------------
// 1. Basic script structure
// ---------------------------------------------------------------------------

describe("nix cloud-init — basic structure", () => {
  it("produces a valid bash script with shebang and set -e", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toMatch(/^#!/);
    expect(script).toContain("#!/bin/bash");
    expect(script).toContain("set -e");
  });

  it("writes openclaw.json via OPENCLAW_CONFIG heredoc", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("Writing openclaw.json");
    expect(script).toContain("OPENCLAW_CONFIG");
  });

  it("JSON config has valid gateway auth", () => {
    const script = runNixCloudInitPipeline(ANTHROPIC_NIX_VM);
    const config = extractJsonConfig(script);
    const gateway = config.gateway as any;
    expect(gateway.auth.mode).toBe("token");
    expect(gateway.auth.token).toBe("gw-token-secret");
  });

  it("JSON config has correct provider env vars", () => {
    const script = runNixCloudInitPipeline(ANTHROPIC_NIX_VM);
    const config = extractJsonConfig(script);
    const env = config.env as Record<string, string>;
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-test-key");
  });

  it("chowns openclaw.json to openclaw user", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("chown openclaw:openclaw");
  });
});

// ---------------------------------------------------------------------------
// 2. Tailscale and systemd (must be present — unlike Docker entrypoint)
// ---------------------------------------------------------------------------

describe("nix cloud-init — Tailscale and systemd", () => {
  it("configures Tailscale with auth key and hostname", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("tailscale up");
    expect(script).toContain("--authkey=");
    expect(script).toContain("--ssh");
    expect(script).toContain("--hostname=dev-agent-test");
  });

  it("restarts openclaw-gateway via systemctl", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("systemctl restart openclaw-gateway");
  });

  it("auto-approves device pairing", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("devices approve --latest");
  });

  it("uses tailscale serve by default (no funnel)", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("tailscale serve --bg");
    expect(script).not.toContain("tailscale funnel");
  });

  it("uses tailscale funnel when enableFunnel is true", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      enableFunnel: true,
    });
    const script = generateNixCloudInit(config);
    expect(script).toContain("tailscale funnel --bg");
  });

  it("uses custom gateway port for tailscale serve", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      gatewayPort: 9999,
    });
    const script = generateNixCloudInit(config);
    expect(script).toContain("tailscale serve --bg 9999");
  });
});

// ---------------------------------------------------------------------------
// 3. Eliminated provisioning (must NOT be present)
// ---------------------------------------------------------------------------

describe("nix cloud-init — eliminated provisioning", () => {
  it("does NOT contain apt-get", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).not.toContain("apt-get");
  });

  it("does NOT contain nvm", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script.toLowerCase()).not.toContain("nvm");
  });

  it("does NOT contain useradd", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).not.toContain("useradd");
  });

  it("does NOT contain docker install", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).not.toContain("get.docker.com");
    expect(script).not.toContain("Install Docker");
  });

  it("does NOT contain loginctl enable-linger", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).not.toContain("loginctl");
    expect(script).not.toContain("enable-linger");
  });

  it("does NOT contain openclaw daemon install", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).not.toContain("openclaw daemon install");
  });

  it("does NOT use /home/ubuntu/ paths", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).not.toContain("/home/ubuntu/");
  });

  it("uses /home/openclaw/ paths", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("/home/openclaw/");
  });
});

// ---------------------------------------------------------------------------
// 4. Coding agent CLI installation
// ---------------------------------------------------------------------------

describe("nix cloud-init — coding agent install", () => {
  it("installs Claude Code CLI via sudo -u openclaw (no NVM)", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("Installing Claude Code");
    expect(script).toContain("sudo -u openclaw");
    expect(script).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(script).not.toContain("NVM_DIR");
    expect(script).not.toContain("nvm.sh");
  });

  it("configures Claude Code default model", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("settings.json");
    expect(script).toContain("claude-opus-4-6");
  });

  it("installs Codex CLI via npm (no NVM)", () => {
    const script = generateNixCloudInit(OPENAI_NIX_VM);
    expect(script).toContain("Installing Codex CLI");
    expect(script).toContain("sudo -u openclaw npm install -g @openai/codex");
    expect(script).not.toContain("NVM_DIR");
    expect(script).not.toContain("nvm.sh");
  });

  it("configures Codex default model", () => {
    const script = generateNixCloudInit(OPENAI_NIX_VM);
    expect(script).toContain("config.toml");
    expect(script).toContain("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// 5. Provider environment and secrets
// ---------------------------------------------------------------------------

describe("nix cloud-init — provider env and secrets", () => {
  it("exports Anthropic API key to .profile", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("export ANTHROPIC_API_KEY=");
    expect(script).toContain("PROFILE_ENV");
  });

  it("exports OpenAI API key for Codex", () => {
    const script = generateNixCloudInit(OPENAI_NIX_VM);
    expect(script).toContain("export OPENAI_API_KEY=");
  });

  it("uses CLAUDE_CODE_OAUTH_TOKEN for OAuth tokens", () => {
    const script = generateNixCloudInit(OAUTH_NIX_VM);
    expect(script).toContain("export CLAUDE_CODE_OAUTH_TOKEN=");
    expect(script).not.toContain("export ANTHROPIC_API_KEY=");
  });

  it("all placeholders replaced after interpolation", () => {
    const script = runNixCloudInitPipeline(ANTHROPIC_NIX_VM);
    expectNoLeakedPlaceholders(script);
  });

  it("all placeholders replaced for OpenAI deploy", () => {
    const script = runNixCloudInitPipeline(OPENAI_NIX_VM);
    expectNoLeakedPlaceholders(script);
  });

  it("special characters in secrets survive interpolation", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-with$pecial" },
      gatewayToken: "gw-token-special",
    });
    const script = runNixCloudInitPipeline(config);
    expect(script).toContain("sk-ant-with$pecial");
  });
});

// ---------------------------------------------------------------------------
// 6. Workspace files
// ---------------------------------------------------------------------------

describe("nix cloud-init — workspace files", () => {
  it("injects workspace files via gzip+base64", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("Injecting workspace files");
    expect(script).toContain("/home/openclaw/.openclaw/workspace/SOUL.md");
    expect(script).toContain("base64 -d | gunzip");
  });

  it("chowns workspace files to openclaw user", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    expect(script).toContain("chown -R openclaw:openclaw /home/openclaw/.openclaw/workspace");
  });

  it("skips workspace section when no files provided", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
    });
    const script = generateNixCloudInit(config);
    expect(script).not.toContain("Injecting workspace files");
  });

  it("rejects directory traversal in file paths", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      workspaceFiles: { "../../../etc/passwd": "evil" },
    });
    expect(() => generateNixCloudInit(config)).toThrow("Invalid workspace file path");
  });
});

// ---------------------------------------------------------------------------
// 7. Plugins and deps
// ---------------------------------------------------------------------------

describe("nix cloud-init — plugins and deps", () => {
  it("installs plugins via sudo -u openclaw openclaw plugins install", () => {
    const config = makeNixCloudInitConfig(
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
    const script = generateNixCloudInit(config);
    expect(script).toContain("sudo -u openclaw openclaw plugins install openclaw-linear");
  });

  it("non-installable plugin skips install", () => {
    const config = makeNixCloudInitConfig(
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
    const script = generateNixCloudInit(config);
    expect(script).not.toContain("openclaw plugins install slack");
  });

  it("runs postProvision hooks via sudo -u openclaw", () => {
    const config = makeNixCloudInitConfig({
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
    const script = generateNixCloudInit(config);
    expect(script).toContain("POST_PROVISION_MARKER");
    expect(script).toContain("postProvision hook for test-plugin");
    expect(script).toContain("sudo -u openclaw bash -c");
  });

  it("runs preStart hooks via sudo -u openclaw", () => {
    const config = makeNixCloudInitConfig({
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
    const script = generateNixCloudInit(config);
    expect(script).toContain("PRE_START_MARKER");
    expect(script).toContain("preStart hook for test-plugin");
  });

  it("runs dep post-install scripts via sudo -u openclaw (skips install scripts)", () => {
    const config = makeNixCloudInitConfig({
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
    const script = generateNixCloudInit(config);
    expect(script).toContain("MARKER_GH_POST_INSTALL");
    expect(script).toContain("sudo -u openclaw bash -c");
    // Should NOT contain root-level install scripts (baked into image)
    expect(script).not.toContain("apt-get install");
  });

  it("installs clawhub skills via sudo -u openclaw", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      clawhubSkills: ["@clawup/review-pr", "@clawup/deploy"],
    });
    const script = generateNixCloudInit(config);
    expect(script).toContain("sudo -u openclaw clawhub install @clawup/review-pr");
    expect(script).toContain("sudo -u openclaw clawhub install @clawup/deploy");
  });
});

// ---------------------------------------------------------------------------
// 8. Additional env vars and git identity
// ---------------------------------------------------------------------------

describe("nix cloud-init — env vars and git identity", () => {
  it("exports additional env vars to .profile", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      envVars: { AGENT_NAME: "Test Agent", CUSTOM_VAR: "custom-value" },
    });
    const script = generateNixCloudInit(config);
    expect(script).toContain('export AGENT_NAME="Test Agent"');
    expect(script).toContain('export CUSTOM_VAR="custom-value"');
  });

  it("configures git identity via sudo -u openclaw when AGENT_NAME is set", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      envVars: { AGENT_NAME: "PM Agent" },
    });
    const script = generateNixCloudInit(config);
    expect(script).toContain('sudo -u openclaw git config --global user.name "PM Agent"');
    expect(script).toContain("@clawup.sh");
  });

  it("runs post-setup commands", () => {
    const config = makeNixCloudInitConfig({
      providerApiKeys: { anthropic: "sk-ant-test" },
      gatewayToken: "gw-token",
      postSetupCommands: ["echo 'POST_SETUP_MARKER'"],
    });
    const script = generateNixCloudInit(config);
    expect(script).toContain("POST_SETUP_MARKER");
  });
});

// ---------------------------------------------------------------------------
// 9. Compression (for Hetzner's 32KB limit)
// ---------------------------------------------------------------------------

describe("nix cloud-init — compression", () => {
  it("compressNixCloudInit produces MIME multipart with base64 payload", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    const compressed = compressNixCloudInit(script);
    expect(compressed).toContain("Content-Type: multipart/mixed");
    expect(compressed).toContain("MIMEBOUNDARY");
    expect(compressed).toContain("Content-Transfer-Encoding: base64");
    expect(compressed).toContain("cloud-init.sh");
  });

  it("compressed output is smaller than raw script", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    const compressed = compressNixCloudInit(script);
    // MIME encoding adds overhead, but gzip compression should still reduce size
    // for non-trivial scripts. The base64 payload should be shorter than the raw script.
    const base64Match = compressed.match(/filename="cloud-init\.sh"\n\n([\s\S]*?)\n--MIMEBOUNDARY/);
    expect(base64Match).toBeTruthy();
    const base64Payload = base64Match![1].trim();
    expect(base64Payload.length).toBeLessThan(script.length);
  });
});

// ---------------------------------------------------------------------------
// 10. Script size
// ---------------------------------------------------------------------------

describe("nix cloud-init — size", () => {
  it("generates a significantly smaller script than Ubuntu cloud-init", () => {
    const script = generateNixCloudInit(ANTHROPIC_NIX_VM);
    const lines = script.split("\n").filter((l) => l.trim().length > 0);
    // The NixOS cloud-init should be much smaller than Ubuntu cloud-init (~490 lines).
    // It's larger than the Docker Nix entrypoint because it includes Tailscale + systemd.
    // For a basic config it should be well under 150 non-empty lines.
    expect(lines.length).toBeLessThan(150);
  });
});
