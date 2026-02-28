/**
 * Integration tests for the cloud-init pipeline.
 *
 * Exercises the full path: CloudInitConfig → generateCloudInit() → interpolateCloudInit()
 * to catch cross-function integration bugs.
 *
 * The openclaw.json is now generated as a complete JSON object by Pulumi
 * (via generateFullOpenClawConfig) and written directly to disk — no Python
 * config-patching or openclaw onboard.
 */

import { describe, it, expect } from "vitest";
import {
  generateCloudInit,
  interpolateCloudInit,
  compressCloudInit,
  type CloudInitConfig,
  type PluginInstallConfig,
} from "../cloud-init";
import { generateFullOpenClawConfig, type PluginEntry } from "../config-generator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Env var name mapping for providers */
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Build providerEnv with OAuth detection (mirrors shared.ts logic).
 */
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

/**
 * Build a full CloudInitConfig with pre-generated openclaw.json.
 * Mirrors the flow in shared.ts: resolve secrets → build providerEnv → generate JSON → assemble config.
 */
function makeConfig(
  base: {
    providerApiKeys: Record<string, string>;
    tailscaleAuthKey: string;
    gatewayToken: string;
    model?: string;
    backupModel?: string;
    codingAgent?: string;
    workspaceFiles?: Record<string, string>;
    skipTailscale?: boolean;
    skipDocker?: boolean;
    foregroundMode?: boolean;
    createUbuntuUser?: boolean;
    plugins?: PluginInstallConfig[];
    deps?: CloudInitConfig["deps"];
    envVars?: Record<string, string>;
    enableFunnel?: boolean;
    clawhubSkills?: string[];
  },
  extras?: {
    resolvedSecrets?: Record<string, string>;
    braveApiKey?: string;
    agentName?: string;
    agentEmoji?: string;
  },
): CloudInitConfig {
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
    backupModel: base.backupModel,
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
    providerApiKeys: base.providerApiKeys,
    tailscaleAuthKey: base.tailscaleAuthKey,
    gatewayToken: base.gatewayToken,
    model: base.model,
    codingAgent: base.codingAgent,
    workspaceFiles: base.workspaceFiles,
    skipTailscale: base.skipTailscale,
    skipDocker: base.skipDocker,
    foregroundMode: base.foregroundMode,
    createUbuntuUser: base.createUbuntuUser,
    plugins: base.plugins,
    deps: base.deps,
    envVars: base.envVars,
    enableFunnel: base.enableFunnel,
    clawhubSkills: base.clawhubSkills,
  };
}

/**
 * Runs the full pipeline: generateCloudInit → interpolateCloudInit.
 * Returns the final interpolated script ready for execution.
 */
function runPipeline(
  config: CloudInitConfig,
  secrets?: Record<string, string>,
): string {
  const raw = generateCloudInit(config);

  // Build additionalSecrets from providerEnv + any extras
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Baseline: Anthropic cloud deploy (the common path) */
const ANTHROPIC_CLOUD = makeConfig({
  providerApiKeys: { anthropic: "sk-ant-api03-test-key" },
  tailscaleAuthKey: "tskey-auth-abc123",
  gatewayToken: "gw-token-secret",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: { "SOUL.md": "You are a helpful PM agent." },
  skipTailscale: true,
});

/** OpenAI + Codex on local Docker */
const OPENAI_LOCAL_DOCKER = makeConfig({
  providerApiKeys: { openai: "sk-openai-test-key" },
  tailscaleAuthKey: "tskey-auth-def456",
  gatewayToken: "gw-token-openai",
  model: "openai/gpt-4o",
  codingAgent: "codex",
  workspaceFiles: {},
  skipDocker: true,
  skipTailscale: true,
  foregroundMode: true,
  createUbuntuUser: true,
});

/** Google provider on cloud with createUbuntuUser (Hetzner-like) */
const GOOGLE_CLOUD = makeConfig({
  providerApiKeys: { google: "google-api-key-test" },
  tailscaleAuthKey: "tskey-auth-ghi789",
  gatewayToken: "gw-token-google",
  model: "google/gemini-2.5-pro",
  codingAgent: "claude-code",
  workspaceFiles: { "IDENTITY.md": "Google agent identity" },
  createUbuntuUser: true,
});

/** Cross-provider fallback: OpenAI primary + Anthropic backup */
const MIXED_PROVIDER = makeConfig({
  providerApiKeys: { openai: "sk-openai-mixed", anthropic: "sk-ant-api03-mixed" },
  tailscaleAuthKey: "tskey-auth-mixed",
  gatewayToken: "gw-token-mixed",
  model: "openai/gpt-4o",
  backupModel: "anthropic/claude-sonnet-4-5",
  codingAgent: "claude-code",
  workspaceFiles: {},
  skipTailscale: true,
});

// ---------------------------------------------------------------------------
// Leak detection
// ---------------------------------------------------------------------------

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
 * Extracts and parses the JSON from the OPENCLAW_CONFIG heredoc.
 */
function extractJsonConfig(script: string): Record<string, unknown> {
  const match = script.match(/cat > .*openclaw\.json << 'OPENCLAW_CONFIG'\n([\s\S]*?)\nOPENCLAW_CONFIG/);
  expect(match, "Expected OPENCLAW_CONFIG heredoc block").toBeTruthy();
  return JSON.parse(match![1]);
}

// ---------------------------------------------------------------------------
// 1. JSON config writing (replaces Python config-patching)
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — JSON config writing", () => {
  it("all providers write openclaw.json via OPENCLAW_CONFIG heredoc", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD, MIXED_PROVIDER]) {
      const script = runPipeline(config);
      expect(script).toContain("Writing openclaw.json");
      expect(script).toContain("OPENCLAW_CONFIG");
      expect(script).not.toContain("openclaw onboard");
      expect(script).not.toContain("PYTHON_SCRIPT");
      expect(script).not.toContain("openclaw doctor");
    }
  });

  it("all providers run devices approve --latest", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD]) {
      const script = runPipeline(config);
      expect(script).toContain("devices approve --latest");
    }
  });

  it("JSON config has valid gateway auth", () => {
    const script = runPipeline(ANTHROPIC_CLOUD);
    const config = extractJsonConfig(script);
    const gateway = config.gateway as any;
    expect(gateway.auth.mode).toBe("token");
    expect(gateway.auth.token).toBe("gw-token-secret");
  });

  it("JSON config has correct provider env vars", () => {
    const script = runPipeline(ANTHROPIC_CLOUD);
    const config = extractJsonConfig(script);
    const env = config.env as Record<string, string>;
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-test-key");
  });

  it("JSON config has correct model for OpenAI deploy", () => {
    const script = runPipeline(OPENAI_LOCAL_DOCKER);
    const config = extractJsonConfig(script);
    const defaults = (config.agents as any).defaults;
    expect(defaults.model).toBe("openai/gpt-4o");
  });

  it("JSON config has model with fallbacks for mixed-provider deploy", () => {
    const script = runPipeline(MIXED_PROVIDER);
    const config = extractJsonConfig(script);
    const defaults = (config.agents as any).defaults;
    expect(defaults.model.primary).toBe("openai/gpt-4o");
    expect(defaults.model.fallbacks).toEqual(["anthropic/claude-sonnet-4-5"]);
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
    const config = makeConfig({
      ...ANTHROPIC_CLOUD,
      providerApiKeys: { anthropic: "sk-ant-with$pecial" },
    });
    const script = runPipeline(config);
    expect(script).toContain("sk-ant-with$pecial");
    expect(script).not.toContain("${ANTHROPIC_API_KEY}");
  });

  it("mixed-provider secrets are both interpolated", () => {
    const script = runPipeline(MIXED_PROVIDER);
    expectNoLeakedPlaceholders(script);
    expect(script).toContain("sk-openai-mixed");
    expect(script).toContain("sk-ant-api03-mixed");
  });

  it("plugin secret env vars are interpolated", () => {
    const config = makeConfig(
      {
        ...ANTHROPIC_CLOUD,
        plugins: [
          {
            name: "openclaw-linear",
            installable: true,
            config: { teamId: "TEAM-123" },
            secretEnvVars: { apiKey: "LINEAR_API_KEY" },
          },
        ],
      },
      { resolvedSecrets: { LINEAR_API_KEY: "lin_api_test_key" } },
    );
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
    const config = makeConfig(
      {
        ...ANTHROPIC_CLOUD,
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
    const script = runPipeline(config, { LINEAR_API_KEY: "lin_test" });
    expect(script).toContain("openclaw plugins install openclaw-linear");
  });

  it("non-installable plugin (slack) skips install but configures in JSON", () => {
    const config = makeConfig(
      {
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
      },
      { resolvedSecrets: { SLACK_BOT_TOKEN: "xoxb-test" } },
    );
    const script = runPipeline(config, { SLACK_BOT_TOKEN: "xoxb-test" });
    expect(script).not.toContain("openclaw plugins install slack");

    // JSON config should have the channel configuration
    const jsonConfig = extractJsonConfig(script);
    const channels = jsonConfig.channels as any;
    expect(channels["slack"]).toBeDefined();
    expect(channels["slack"].teamId).toBe("T123");
    expect(channels["slack"].botToken).toBe("xoxb-test");
  });

  it("plugin config is embedded in JSON for plugins.entries path", () => {
    const config = makeConfig(
      {
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
      },
      { resolvedSecrets: { LINEAR_API_KEY: "lin_test" } },
    );
    const script = runPipeline(config, { LINEAR_API_KEY: "lin_test" });
    const jsonConfig = extractJsonConfig(script);
    const entries = (jsonConfig.plugins as any).entries;
    expect(entries["openclaw-linear"]).toBeDefined();
    expect(entries["openclaw-linear"].config.teamId).toBe("TEAM-456");
    expect(entries["openclaw-linear"].config.apiKey).toBe("lin_test");
  });

  it("postProvision hooks run before JSON write, preStart hooks run after", () => {
    const config = makeConfig({
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
    });
    const script = runPipeline(config);

    expect(script).toContain("POST_PROVISION_MARKER");
    expect(script).toContain("PRE_START_MARKER");

    // postProvision should come before OPENCLAW_CONFIG write
    const postProvisionIdx = script.indexOf("POST_PROVISION_MARKER");
    const jsonIdx = script.indexOf("OPENCLAW_CONFIG");
    expect(postProvisionIdx).toBeGreaterThan(jsonIdx);

    // preStart should come after the JSON write section
    const preStartIdx = script.indexOf("PRE_START_MARKER");
    const jsonEndIdx = script.lastIndexOf("OPENCLAW_CONFIG");
    expect(preStartIdx).toBeGreaterThan(jsonEndIdx);
  });

  it("dep install + post-install scripts included; Brave search configured in JSON", () => {
    const config = makeConfig(
      {
        ...ANTHROPIC_CLOUD,
        deps: [
          {
            name: "gh",
            installScript: '# MARKER_GH_INSTALL\napt-get install -y gh',
            postInstallScript: '# MARKER_GH_POST_INSTALL\ngh auth login',
            secrets: { GithubToken: { envVar: "GITHUB_TOKEN" } },
          },
        ],
      },
      { braveApiKey: "brave-key-test" },
    );
    const script = runPipeline(config, {
      BRAVE_API_KEY: "brave-key-test",
      GITHUB_TOKEN: "ghp_test",
    });

    // Root-level install script present
    expect(script).toContain("MARKER_GH_INSTALL");
    // User-level post-install present
    expect(script).toContain("MARKER_GH_POST_INSTALL");

    // Brave search in JSON config
    const jsonConfig = extractJsonConfig(script);
    const tools = jsonConfig.tools as any;
    expect(tools.web.search.provider).toBe("brave");
    expect(tools.web.search.apiKey).toBe("brave-key-test");
  });
});

// ---------------------------------------------------------------------------
// 5. Plugin internalKeys filtering
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — internalKeys filtering", () => {
  it("filters internalKeys from plugins.entries config in JSON", () => {
    const config = makeConfig(
      {
        ...ANTHROPIC_CLOUD,
        plugins: [
          {
            name: "openclaw-linear",
            installable: true,
            configPath: "plugins.entries",
            config: {
              agentId: "pm",
              linearUserUuid: "uuid-1234",
              agentMapping: { "uuid-1234": "default" },
              stateActions: { started: "add" },
            },
            secretEnvVars: {
              apiKey: "LINEAR_API_KEY",
              webhookSecret: "LINEAR_WEBHOOK_SECRET",
              linearUserUuid: "LINEAR_USER_UUID",
            },
            internalKeys: ["agentId", "linearUserUuid"],
          },
        ],
      },
      {
        resolvedSecrets: {
          LINEAR_API_KEY: "lin_api_test",
          LINEAR_WEBHOOK_SECRET: "whsec_test",
          LINEAR_USER_UUID: "uuid-1234",
        },
      },
    );
    const script = runPipeline(config, {
      LINEAR_API_KEY: "lin_api_test",
      LINEAR_WEBHOOK_SECRET: "whsec_test",
      LINEAR_USER_UUID: "uuid-1234",
    });
    const jsonConfig = extractJsonConfig(script);
    const pluginConfig = (jsonConfig.plugins as any).entries["openclaw-linear"].config;

    // Valid secrets should be written
    expect(pluginConfig.apiKey).toBe("lin_api_test");
    expect(pluginConfig.webhookSecret).toBe("whsec_test");

    // Valid config properties should be written
    expect(pluginConfig.agentMapping).toBeDefined();
    expect(pluginConfig.stateActions).toBeDefined();

    // Internal keys should NOT appear
    expect(pluginConfig.agentId).toBeUndefined();
    expect(pluginConfig.linearUserUuid).toBeUndefined();
  });

  it("filters internalKeys from channels config in JSON", () => {
    const config = makeConfig(
      {
        ...ANTHROPIC_CLOUD,
        plugins: [
          {
            name: "slack",
            installable: false,
            configPath: "channels",
            config: {
              agentId: "eng",
              mode: "socket",
            },
            secretEnvVars: {
              botToken: "SLACK_BOT_TOKEN",
              appToken: "SLACK_APP_TOKEN",
            },
            internalKeys: ["agentId"],
          },
        ],
      },
      {
        resolvedSecrets: {
          SLACK_BOT_TOKEN: "xoxb-test",
          SLACK_APP_TOKEN: "xapp-test",
        },
      },
    );
    const script = runPipeline(config, {
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_APP_TOKEN: "xapp-test",
    });
    const jsonConfig = extractJsonConfig(script);
    const slack = (jsonConfig.channels as any)["slack"];

    expect(slack.botToken).toBe("xoxb-test");
    expect(slack.appToken).toBe("xapp-test");
    expect(slack.mode).toBe("socket");
    expect(slack.agentId).toBeUndefined();
  });

  it("passes all config through when internalKeys is empty", () => {
    const config = makeConfig(
      {
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
      },
      { resolvedSecrets: { TEST_TOKEN: "tok_test" } },
    );
    const script = runPipeline(config, { TEST_TOKEN: "tok_test" });
    const jsonConfig = extractJsonConfig(script);
    const pluginConfig = (jsonConfig.plugins as any).entries["test-plugin"].config;

    expect(pluginConfig.someKey).toBe("someValue");
    expect(pluginConfig.token).toBe("tok_test");
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
