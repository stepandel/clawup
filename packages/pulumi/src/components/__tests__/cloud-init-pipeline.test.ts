/**
 * Integration tests for the cloud-init pipeline.
 *
 * Exercises the full path: CloudInitConfig → generateCloudInit() → interpolateCloudInit()
 * to catch cross-function integration bugs (like the production bug where non-Anthropic
 * providers failed because `openclaw onboard` requires provider-specific flags).
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
 * Extracts the CONFIG_PATCH heredoc and asserts it has valid structure.
 */
function expectValidConfigPatchBlock(script: string): void {
  const match = script.match(
    /bash << 'CONFIG_PATCH'\n([\s\S]*?)\nCONFIG_PATCH/,
  );
  expect(match, "Expected CONFIG_PATCH heredoc block").toBeTruthy();
  const bash = match![1];

  expect(bash).toContain("openclaw config set");
  expect(bash).not.toContain("import json");
  expect(bash).not.toContain("json.dump");
  expect(bash).not.toContain("python3");
}

// ---------------------------------------------------------------------------
// 1. Onboard-based provisioning (all providers use openclaw onboard)
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — onboard-based provisioning", () => {
  it("all providers run openclaw onboard --non-interactive", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD, MIXED_PROVIDER]) {
      const script = runPipeline(config);
      expect(script).toContain("openclaw onboard --non-interactive");
      expect(script).toContain("Onboarding complete");
    }
  });

  it("all providers use bash CONFIG_PATCH block (not Python)", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD, MIXED_PROVIDER]) {
      const script = runPipeline(config);
      expectValidConfigPatchBlock(script);
      expect(script).not.toContain("python3 << 'PYTHON_SCRIPT'");
      expect(script).not.toContain("PYTHON_SCRIPT");
    }
  });

  it("all providers run openclaw doctor --fix", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD]) {
      const script = runPipeline(config);
      expect(script).toContain("openclaw doctor --fix");
    }
  });

  it("all providers run devices approve --latest", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD]) {
      const script = runPipeline(config);
      expect(script).toContain("devices approve --latest");
    }
  });

  it("CONFIG_PATCH block uses openclaw config set commands", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expectValidConfigPatchBlock(script);
    const match = script.match(
      /bash << 'CONFIG_PATCH'\n([\s\S]*?)\nCONFIG_PATCH/,
    );
    const bash = match![1];
    expect(bash).toContain("openclaw config set gateway.auth");
    expect(bash).toContain("openclaw config set agents.defaults.heartbeat");
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

  it("foregroundMode runs openclaw gateway instead of systemd, with device auto-pairing", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    expect(script).toContain("openclaw gateway");
    expect(script).toContain("devices approve --latest");
    expect(script).not.toContain("openclaw daemon install");
    expect(script).not.toContain("systemctl start user@1000");
    expect(script).not.toContain("loginctl enable-linger");
  });

  it("cloud deploy uses systemd daemon with device auto-pairing", () => {
    const script = runPipeline(ANTHROPIC_CLOUD);
    expect(script).toContain("openclaw daemon install");
    expect(script).toContain("loginctl enable-linger");
    expect(script).toContain("devices approve --latest");
    expect(script).not.toContain("openclaw gateway &");
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

  it("non-installable plugin (slack) skips install but configures in bash", () => {
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
    // But CONFIG_PATCH should have the channel configuration
    const match = script.match(
      /bash << 'CONFIG_PATCH'\n([\s\S]*?)\nCONFIG_PATCH/,
    );
    expect(match).toBeTruthy();
    expect(match![1]).toContain('Configure slack channel');
    expect(match![1]).toContain('channels.slack');
  });

  it("plugin config is embedded in bash for plugins.entries path", () => {
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
    const match = script.match(
      /bash << 'CONFIG_PATCH'\n([\s\S]*?)\nCONFIG_PATCH/,
    );
    expect(match).toBeTruthy();
    const bash = match![1];
    expect(bash).toContain('plugins.entries.openclaw-linear');
    expect(bash).toContain('"TEAM-456"');
  });

  it("postProvision hooks run before CONFIG_PATCH, preStart hooks run after", () => {
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

    // postProvision should come before CONFIG_PATCH
    const postProvisionIdx = script.indexOf("POST_PROVISION_MARKER");
    const configPatchIdx = script.indexOf("CONFIG_PATCH");
    expect(postProvisionIdx).toBeLessThan(configPatchIdx);

    // preStart should come after CONFIG_PATCH
    const preStartIdx = script.indexOf("PRE_START_MARKER");
    const configPatchEndIdx = script.lastIndexOf("CONFIG_PATCH");
    expect(preStartIdx).toBeGreaterThan(configPatchEndIdx);
  });

  it("dep install + post-install scripts included; Brave search configured in bash", () => {
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

    // Brave search in bash config patch
    const match = script.match(
      /bash << 'CONFIG_PATCH'\n([\s\S]*?)\nCONFIG_PATCH/,
    );
    expect(match).toBeTruthy();
    expect(match![1]).toContain("brave");
    expect(match![1]).toContain("BRAVE_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// 5. Plugin internalKeys filtering
// ---------------------------------------------------------------------------

/**
 * Tests that internalKeys are correctly filtered from the generated plugin
 * config. This prevents OpenClaw config validation failures caused by
 * properties that are not in the plugin's configSchema.
 */
describe("cloud-init pipeline — internalKeys filtering", () => {
  /** Helper: extract the bash config patch script from the cloud-init output */
  function extractConfigPatch(script: string): string {
    const match = script.match(
      /bash << 'CONFIG_PATCH'\n([\s\S]*?)\nCONFIG_PATCH/,
    );
    expect(match).toBeTruthy();
    return match![1];
  }

  it("filters internalKeys from plugins.entries config and secretEnvVars", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "openclaw-linear",
          installable: true,
          configPath: "plugins.entries",
          config: {
            agentId: "pm",                              // internalKey — should be filtered
            linearUserUuid: "uuid-1234",                // internalKey — should be filtered
            agentMapping: { "uuid-1234": "default" },   // valid plugin property — should remain
            stateActions: { started: "add" },            // valid plugin property — should remain
          },
          secretEnvVars: {
            apiKey: "LINEAR_API_KEY",
            webhookSecret: "LINEAR_WEBHOOK_SECRET",
            linearUserUuid: "LINEAR_USER_UUID",         // internalKey in secretEnvVars — should be filtered
          },
          internalKeys: ["agentId", "linearUserUuid"],
        },
      ],
    };
    const script = runPipeline(config, {
      LINEAR_API_KEY: "lin_api_test",
      LINEAR_WEBHOOK_SECRET: "whsec_test",
      LINEAR_USER_UUID: "uuid-1234",
    });
    const bash = extractConfigPatch(script);

    // Valid secrets should be written to plugin config
    expect(bash).toContain("plugins.entries.openclaw-linear.config.apiKey");
    expect(bash).toContain("LINEAR_API_KEY");
    expect(bash).toContain("plugins.entries.openclaw-linear.config.webhookSecret");
    expect(bash).toContain("LINEAR_WEBHOOK_SECRET");

    // Valid config properties should be written
    expect(bash).toContain("agentMapping");
    expect(bash).toContain("stateActions");

    // Internal keys should NOT appear anywhere in the plugin config
    expect(bash).not.toContain("config.agentId");
    expect(bash).not.toContain("config.linearUserUuid");
    expect(bash).not.toContain("LINEAR_USER_UUID");
  });

  it("filters internalKeys from channels config", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "slack",
          installable: false,
          configPath: "channels",
          config: {
            agentId: "eng",         // internalKey — should be filtered
            mode: "socket",         // valid — should remain
          },
          secretEnvVars: {
            botToken: "SLACK_BOT_TOKEN",
            appToken: "SLACK_APP_TOKEN",
          },
          internalKeys: ["agentId"],
        },
      ],
    };
    const script = runPipeline(config, {
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_APP_TOKEN: "xapp-test",
    });
    const bash = extractConfigPatch(script);

    // Valid secrets should be written
    expect(bash).toContain("channels.slack.botToken");
    expect(bash).toContain("SLACK_BOT_TOKEN");
    expect(bash).toContain("channels.slack.appToken");
    expect(bash).toContain("SLACK_APP_TOKEN");

    // Valid config should remain
    expect(bash).toContain("channels.slack.mode");

    // Internal key should NOT appear
    expect(bash).not.toContain("channels.slack.agentId");
  });

  it("passes all config through when internalKeys is empty", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      plugins: [
        {
          name: "test-plugin",
          installable: true,
          configPath: "plugins.entries",
          config: { someKey: "someValue" },
          secretEnvVars: { token: "TEST_TOKEN" },
          internalKeys: [],
        },
      ],
    };
    const script = runPipeline(config, { TEST_TOKEN: "tok_test" });
    const bash = extractConfigPatch(script);

    expect(bash).toContain("plugins.entries.test-plugin.config.someKey");
    expect(bash).toContain("plugins.entries.test-plugin.config.token");
    expect(bash).toContain("TEST_TOKEN");
  });
});

// ---------------------------------------------------------------------------
// 6. Compression
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
