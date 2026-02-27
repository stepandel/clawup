/**
 * Integration tests for the cloud-init pipeline.
 *
 * Exercises the full path: CloudInitConfig → generateCloudInit() → interpolateCloudInit()
 * to catch cross-function integration bugs (like the production bug where non-Anthropic
 * providers failed because `openclaw onboard` requires ANTHROPIC_API_KEY).
 */

import { describe, it, expect } from "vitest";
import {
  generateCloudInit,
  interpolateCloudInit,
  compressCloudInit,
  type CloudInitConfig,
  type PluginInstallConfig,
} from "../cloud-init";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Baseline: Anthropic cloud deploy (the common path) */
const ANTHROPIC_CLOUD: CloudInitConfig = {
  providerApiKeys: { anthropic: "sk-ant-api03-test-key" },
  tailscaleAuthKey: "tskey-auth-abc123",
  gatewayToken: "gw-token-secret",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: { "SOUL.md": "You are a helpful PM agent." },
  skipTailscale: true,
};

/** The broken production case: OpenAI + Codex on local Docker */
const OPENAI_LOCAL_DOCKER: CloudInitConfig = {
  providerApiKeys: { openai: "sk-openai-test-key" },
  modelProvider: "openai",
  tailscaleAuthKey: "tskey-auth-def456",
  gatewayToken: "gw-token-openai",
  model: "openai/gpt-4o",
  codingAgent: "codex",
  workspaceFiles: {},
  skipDocker: true,
  skipTailscale: true,
  foregroundMode: true,
  createUbuntuUser: true,
};

/** Google provider on cloud with createUbuntuUser (Hetzner-like) */
const GOOGLE_CLOUD: CloudInitConfig = {
  providerApiKeys: { google: "google-api-key-test" },
  modelProvider: "google",
  tailscaleAuthKey: "tskey-auth-ghi789",
  gatewayToken: "gw-token-google",
  model: "google/gemini-2.5-pro",
  codingAgent: "claude-code",
  workspaceFiles: { "IDENTITY.md": "Google agent identity" },
  createUbuntuUser: true,
};

/** Cross-provider fallback: OpenAI primary + Anthropic backup */
const MIXED_PROVIDER: CloudInitConfig = {
  providerApiKeys: { openai: "sk-openai-mixed", anthropic: "sk-ant-api03-mixed" },
  modelProvider: "openai",
  tailscaleAuthKey: "tskey-auth-mixed",
  gatewayToken: "gw-token-mixed",
  model: "openai/gpt-4o",
  backupModel: "anthropic/claude-sonnet-4-5",
  codingAgent: "claude-code",
  workspaceFiles: {},
  skipTailscale: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs the full pipeline: generateCloudInit → interpolateCloudInit.
 * Returns the final interpolated script ready for execution.
 */
function runPipeline(
  config: CloudInitConfig,
  secrets?: Record<string, string>,
): string {
  const raw = generateCloudInit(config);

  // Build additionalSecrets from providerApiKeys env vars + any extras
  const additionalSecrets: Record<string, string> = { ...secrets };
  for (const [providerKey, value] of Object.entries(config.providerApiKeys)) {
    // Map provider keys to their env var names
    const envVarMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };
    const envVar = envVarMap[providerKey];
    if (envVar) additionalSecrets[envVar] = value;
  }

  return interpolateCloudInit(raw, {
    tailscaleAuthKey: config.tailscaleAuthKey,
    gatewayToken: config.gatewayToken,
    additionalSecrets,
  });
}

/**
 * Known runtime variables that legitimately appear as ${VAR} in the final script
 * (they are resolved by bash at execution time, not by interpolateCloudInit).
 */
const RUNTIME_VARS = new Set([
  "HOME",
  "NVM_DIR",
  "GATEWAY_PORT",
  "MODEL",
  "BINARY_PATH",
  "GITHUB_TOKEN",
]);

/**
 * Scans for unsubstituted ${SCREAMING_SNAKE} placeholders, excluding known runtime vars.
 */
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

/**
 * Extracts the PYTHON_SCRIPT heredoc and asserts it has valid structure.
 */
function expectValidPythonBlock(script: string): void {
  const pythonMatch = script.match(
    /python3 << 'PYTHON_SCRIPT'\n([\s\S]*?)\nPYTHON_SCRIPT/,
  );
  expect(pythonMatch, "Expected PYTHON_SCRIPT heredoc block").toBeTruthy();
  const python = pythonMatch![1];

  expect(python).toContain("import json");
  expect(python).toContain("import os");
  expect(python).toContain("config_path");
  expect(python).toContain("json.dump");

  // Roughly balanced braces (Python dicts)
  const opens = (python.match(/{/g) || []).length;
  const closes = (python.match(/}/g) || []).length;
  expect(Math.abs(opens - closes)).toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// 1. Provider-conditional onboarding (targets the production bug)
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — provider-conditional onboarding", () => {
  it("Anthropic provider runs openclaw onboard with ANTHROPIC_API_KEY", () => {
    const script = runPipeline(ANTHROPIC_CLOUD);
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("ANTHROPIC_API_KEY=");
    expect(script).not.toContain("Skipping OpenClaw onboarding");
  });

  it("OpenAI provider skips onboard and creates skeleton openclaw.json", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expect(script).toContain("Skipping OpenClaw onboarding (non-Anthropic provider: openai)");
    expect(script).toContain("openclaw.json");
    expect(script).not.toContain("openclaw onboard --non-interactive");
  });

  it("Google provider skips onboard and creates skeleton openclaw.json", () => {
    const script = runPipeline(GOOGLE_CLOUD);
    expect(script).toContain("Skipping OpenClaw onboarding (non-Anthropic provider: google)");
    expect(script).toContain("openclaw.json");
    expect(script).not.toContain("openclaw onboard --non-interactive");
  });

  it("Python config-patch has os.path.exists() fallback for missing openclaw.json", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expectValidPythonBlock(script);
    const pythonMatch = script.match(
      /python3 << 'PYTHON_SCRIPT'\n([\s\S]*?)\nPYTHON_SCRIPT/,
    );
    const python = pythonMatch![1];
    expect(python).toContain("os.path.exists(config_path)");
    // Non-Anthropic should have the skeleton fallback branch
    expect(python).toContain("Create default skeleton if onboarding was skipped");
  });
});

// ---------------------------------------------------------------------------
// 2. Local Docker deploy shape
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — local Docker deploy shape", () => {
  it("skipDocker omits Docker installation", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expect(script).not.toContain("Install Docker");
    expect(script).not.toContain("curl -fsSL https://get.docker.com");
  });

  it("skipTailscale omits Tailscale section", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expect(script).not.toContain("Installing Tailscale");
    expect(script).not.toContain("tailscale up");
  });

  it("createUbuntuUser without docker group for local Docker", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    // Local Docker creates user WITHOUT docker group
    expect(script).toContain("local Docker");
    expect(script).toContain("useradd -m -s /bin/bash ubuntu");
    expect(script).not.toContain("-G docker ubuntu");
  });

  it("foregroundMode runs exec openclaw gateway instead of systemd", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expect(script).toContain("exec openclaw gateway");
    expect(script).not.toContain("openclaw daemon install");
    expect(script).not.toContain("systemctl start user@1000");
    expect(script).not.toContain("loginctl enable-linger");
  });

  it("cloud deploy uses systemd daemon (inverse of foreground)", () => {
    const script = runPipeline(ANTHROPIC_CLOUD);
    expect(script).toContain("openclaw daemon install");
    expect(script).toContain("loginctl enable-linger");
    expect(script).not.toContain("exec openclaw gateway");
  });
});

// ---------------------------------------------------------------------------
// 3. Interpolation and secret handling
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — interpolation and secrets", () => {
  it("all placeholders replaced for Anthropic deploy", () => {
    const script = runPipeline(ANTHROPIC_CLOUD);
    expectNoLeakedPlaceholders(script);
  });

  it("all placeholders replaced for OpenAI deploy", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expectNoLeakedPlaceholders(script);
  });

  it("special characters in secrets survive interpolation", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      providerApiKeys: { anthropic: "sk-ant-with$pecial" },
    };
    const script = runPipeline(config);
    // The $-replacement escaping in interpolateCloudInit ensures $ passes through
    // .replace() without being treated as a special replacement pattern ($&, $1, etc.)
    expect(script).toContain("sk-ant-with$pecial");
    // The placeholder should be fully replaced
    expect(script).not.toContain("${ANTHROPIC_API_KEY}");
  });

  it("mixed-provider secrets are both interpolated", () => {
    const script = runPipeline(MIXED_PROVIDER);
    expectNoLeakedPlaceholders(script);
    // Both provider env vars should have their values injected
    expect(script).toContain("sk-openai-mixed");
    expect(script).toContain("sk-ant-api03-mixed");
  });

  it("plugin secret env vars are interpolated", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "openclaw-linear",
          installable: true,
          config: { teamId: "TEAM-123" },
          secretEnvVars: { apiKey: "LINEAR_API_KEY" },
        },
      ],
    };
    const script = runPipeline(config, { LINEAR_API_KEY: "lin_api_test_key" });
    expectNoLeakedPlaceholders(script);
    expect(script).toContain("lin_api_test_key");
  });
});

// ---------------------------------------------------------------------------
// 4. Plugins and deps
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — plugins and deps", () => {
  it("installable plugin generates openclaw plugins install command", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "openclaw-linear",
          installable: true,
          config: {},
          secretEnvVars: { apiKey: "LINEAR_API_KEY" },
        },
      ],
    };
    const script = runPipeline(config, { LINEAR_API_KEY: "lin_test" });
    expect(script).toContain("openclaw plugins install openclaw-linear");
  });

  it("non-installable plugin (slack) skips install but configures in Python", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "slack",
          installable: false,
          configPath: "channels",
          config: { teamId: "T123" },
          secretEnvVars: { botToken: "SLACK_BOT_TOKEN" },
        },
      ],
    };
    const script = runPipeline(config, { SLACK_BOT_TOKEN: "xoxb-test" });
    // Should NOT have install command
    expect(script).not.toContain("openclaw plugins install slack");
    // But Python config should have the channel configuration
    const pythonMatch = script.match(
      /python3 << 'PYTHON_SCRIPT'\n([\s\S]*?)\nPYTHON_SCRIPT/,
    );
    expect(pythonMatch).toBeTruthy();
    expect(pythonMatch![1]).toContain('Configure slack channel');
    expect(pythonMatch![1]).toContain('"channels"');
  });

  it("plugin config is embedded in Python for plugins.entries path", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "openclaw-linear",
          installable: true,
          configPath: "plugins.entries",
          config: { teamId: "TEAM-456" },
          secretEnvVars: { apiKey: "LINEAR_API_KEY" },
        },
      ],
    };
    const script = runPipeline(config, { LINEAR_API_KEY: "lin_test" });
    const pythonMatch = script.match(
      /python3 << 'PYTHON_SCRIPT'\n([\s\S]*?)\nPYTHON_SCRIPT/,
    );
    expect(pythonMatch).toBeTruthy();
    const python = pythonMatch![1];
    expect(python).toContain('"plugins"');
    expect(python).toContain('"entries"');
    expect(python).toContain('"openclaw-linear"');
    expect(python).toContain('"TEAM-456"');
  });

  it("postProvision hooks run before Python patch, preStart hooks run after", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "test-plugin",
          installable: true,
          config: {},
          hooks: {
            postProvision: 'echo "POST_PROVISION_MARKER"',
            preStart: 'echo "PRE_START_MARKER"',
          },
        },
      ],
    };
    const script = runPipeline(config);

    expect(script).toContain("POST_PROVISION_MARKER");
    expect(script).toContain("PRE_START_MARKER");

    // postProvision should come before PYTHON_SCRIPT
    const postProvisionIdx = script.indexOf("POST_PROVISION_MARKER");
    const pythonIdx = script.indexOf("PYTHON_SCRIPT");
    expect(postProvisionIdx).toBeLessThan(pythonIdx);

    // preStart should come after PYTHON_SCRIPT
    const preStartIdx = script.indexOf("PRE_START_MARKER");
    const pythonEndIdx = script.lastIndexOf("PYTHON_SCRIPT");
    expect(preStartIdx).toBeGreaterThan(pythonEndIdx);
  });

  it("dep install + post-install scripts included; Brave search configured in Python", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      deps: [
        {
          name: "gh",
          installScript: '# MARKER_GH_INSTALL\napt-get install -y gh',
          postInstallScript: '# MARKER_GH_POST_INSTALL\ngh auth login',
          secrets: { GithubToken: { envVar: "GITHUB_TOKEN" } },
        },
      ],
      depSecrets: { BRAVE_API_KEY: "brave-key-test", GITHUB_TOKEN: "ghp_test" },
    };
    const script = runPipeline(config, {
      BRAVE_API_KEY: "brave-key-test",
      GITHUB_TOKEN: "ghp_test",
    });

    // Root-level install script present
    expect(script).toContain("MARKER_GH_INSTALL");
    // User-level post-install present
    expect(script).toContain("MARKER_GH_POST_INSTALL");

    // Brave search in Python config patch
    const pythonMatch = script.match(
      /python3 << 'PYTHON_SCRIPT'\n([\s\S]*?)\nPYTHON_SCRIPT/,
    );
    expect(pythonMatch).toBeTruthy();
    expect(pythonMatch![1]).toContain("brave");
    expect(pythonMatch![1]).toContain("BRAVE_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// 5. Compression
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — compression", () => {
  it("compressCloudInit wraps in base64+gzip self-extractor, output smaller than input", () => {
    const raw = generateCloudInit(ANTHROPIC_CLOUD);
    const compressed = compressCloudInit(raw);

    expect(compressed).toContain("#!/bin/bash");
    expect(compressed).toContain("base64 -d");
    expect(compressed).toContain("gunzip");
    expect(compressed).toContain("COMPRESSED_PAYLOAD");
    expect(compressed.length).toBeLessThan(raw.length);
  });
});
