/**
 * Integration tests for the cloud-init pipeline.
 *
 * Exercises the full path: CloudInitConfig → buildProvisionerConfig() → generateCloudInit()
 * Verifies the JSON config structure and bash template integration.
 */

import { describe, it, expect } from "vitest";
import {
  generateCloudInit,
  compressCloudInit,
  type CloudInitConfig,
} from "../cloud-init";
import { buildProvisionerConfig, type ProvisionerConfig } from "../provisioner-config";

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

/** Build the provisioner config from a CloudInitConfig */
function buildConfig(config: CloudInitConfig): ProvisionerConfig {
  return buildProvisionerConfig(config);
}

/** Generate the full bash script from a CloudInitConfig */
function generateScript(config: CloudInitConfig): string {
  return generateCloudInit(config);
}

/** Decode the CONFIG_B64 blob from a generated script */
function extractConfigJson(script: string): ProvisionerConfig {
  const match = script.match(/CONFIG_B64="([^"]+)"/);
  expect(match, "Expected CONFIG_B64 in script").toBeTruthy();
  const json = Buffer.from(match![1], "base64").toString("utf-8");
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// 1. Provisioner template structure
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — provisioner template structure", () => {
  it("generates a bash script with CONFIG_B64 and phase functions", () => {
    const script = generateScript(ANTHROPIC_CLOUD);
    expect(script).toContain("#!/bin/bash");
    expect(script).toContain("CONFIG_B64=");
    expect(script).toContain("phase_system");
    expect(script).toContain("phase_onboard");
    expect(script).toContain("phase_config");
    expect(script).toContain("phase_daemon");
    expect(script).toContain("cfg()");
    expect(script).toContain("run_as_ubuntu()");
  });

  it("embeds valid JSON config in CONFIG_B64", () => {
    const script = generateScript(ANTHROPIC_CLOUD);
    const config = extractConfigJson(script);
    expect(config.gatewayPort).toBe(18789);
    expect(config.gatewayToken).toBe("gw-token-secret");
  });

  it("does not contain Python references", () => {
    const script = generateScript(ANTHROPIC_CLOUD);
    expect(script).not.toContain("python3");
    expect(script).not.toContain("import json");
    expect(script).not.toContain("json.dump");
  });

  it("installs jq in apt-get", () => {
    const script = generateScript(ANTHROPIC_CLOUD);
    expect(script).toContain("jq");
  });
});

// ---------------------------------------------------------------------------
// 2. Onboard-based provisioning
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — onboard-based provisioning", () => {
  it("all providers have onboard command in config", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD, MIXED_PROVIDER]) {
      const provConfig = buildConfig(config);
      expect(provConfig.onboard.command).toContain("openclaw onboard --non-interactive");
    }
  });

  it("all providers have onboard phase in template", () => {
    for (const config of [ANTHROPIC_CLOUD, OPENAI_LOCAL_DOCKER, GOOGLE_CLOUD, MIXED_PROVIDER]) {
      const script = generateScript(config);
      expect(script).toContain("phase_onboard");
      expect(script).toContain("Onboarding complete");
    }
  });

  it("all providers have doctor and device pairing in template", () => {
    const script = generateScript(ANTHROPIC_CLOUD);
    expect(script).toContain("openclaw doctor --fix");
    expect(script).toContain("devices approve --latest");
  });

  it("configSetCommands include gateway auth and heartbeat", () => {
    const provConfig = buildConfig(OPENAI_LOCAL_DOCKER);
    const keys = provConfig.configSetCommands.map((c) => c.key);
    expect(keys).toContain("gateway.auth");
    expect(keys).toContain("agents.defaults.heartbeat");
  });
});

// ---------------------------------------------------------------------------
// 3. Local Docker deploy shape
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — local Docker deploy shape", () => {
  it("skipDocker sets skipDocker flag in config", () => {
    const provConfig = buildConfig(OPENAI_LOCAL_DOCKER);
    expect(provConfig.skipDocker).toBe(true);
  });

  it("skipTailscale sets tailscale.skip flag in config", () => {
    const provConfig = buildConfig(OPENAI_LOCAL_DOCKER);
    expect(provConfig.tailscale.skip).toBe(true);
  });

  it("createUbuntuUser with skipDocker uses skipDockerGroup", () => {
    const provConfig = buildConfig(OPENAI_LOCAL_DOCKER);
    expect(provConfig.createUbuntuUser).toBe(true);
    expect(provConfig.skipDockerGroup).toBe(true);
  });

  it("foregroundMode set in config", () => {
    const provConfig = buildConfig(OPENAI_LOCAL_DOCKER);
    expect(provConfig.foregroundMode).toBe(true);
  });

  it("foreground template includes gateway and device pairing", () => {
    const script = generateScript(OPENAI_LOCAL_DOCKER);
    expect(script).toContain("openclaw gateway");
    expect(script).toContain("devices approve --latest");
  });

  it("cloud deploy template has daemon install and systemd linger", () => {
    const script = generateScript(ANTHROPIC_CLOUD);
    expect(script).toContain("openclaw daemon install");
    expect(script).toContain("loginctl enable-linger");
  });
});

// ---------------------------------------------------------------------------
// 4. Secrets embedded in JSON (no interpolation needed)
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — secrets in JSON config", () => {
  it("secrets are embedded directly in the provisioner config", () => {
    const provConfig = buildConfig(ANTHROPIC_CLOUD);
    expect(provConfig.tailscale.authKey).toBe("tskey-auth-abc123");
    expect(provConfig.gatewayToken).toBe("gw-token-secret");
    expect(provConfig.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-test-key");
  });

  it("onboard command contains actual API key value", () => {
    const provConfig = buildConfig(ANTHROPIC_CLOUD);
    expect(provConfig.onboard.command).toContain("sk-ant-api03-test-key");
  });

  it("special characters in secrets survive JSON encoding", () => {
    const config: CloudInitConfig = {
      ...ANTHROPIC_CLOUD,
      providerApiKeys: { anthropic: "sk-ant-with$pecial" },
    };
    const provConfig = buildConfig(config);
    expect(provConfig.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("sk-ant-with$pecial");

    // Verify it round-trips through the script
    const script = generateScript(config);
    const extracted = extractConfigJson(script);
    expect(extracted.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("sk-ant-with$pecial");
  });

  it("mixed-provider secrets are both in config", () => {
    const provConfig = buildConfig(MIXED_PROVIDER);
    expect(provConfig.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-openai-mixed");
    expect(provConfig.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-mixed");
  });

  it("plugin secret env vars are included in config", () => {
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
      depSecrets: { LINEAR_API_KEY: "lin_api_test_key", ANTHROPIC_API_KEY: "sk-ant-api03-test-key" },
    };
    const provConfig = buildConfig(config);
    expect(provConfig.profileEnvVars["LINEAR_API_KEY"]).toBe("lin_api_test_key");

    // Check the config set command has the actual value
    const apiKeyCmds = provConfig.configSetCommands.filter(
      (c) => c.key === "plugins.entries.openclaw-linear.config.apiKey",
    );
    expect(apiKeyCmds.length).toBe(1);
    expect(apiKeyCmds[0].value).toBe("lin_api_test_key");
  });
});

// ---------------------------------------------------------------------------
// 5. Plugins and deps
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — plugins and deps", () => {
  it("installable plugin is in installablePlugins list", () => {
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
    const provConfig = buildConfig(config);
    expect(provConfig.installablePlugins).toContain("openclaw-linear");
  });

  it("non-installable plugin (slack) not in installablePlugins but has config commands", () => {
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
      depSecrets: { SLACK_BOT_TOKEN: "xoxb-test", ANTHROPIC_API_KEY: "sk-ant-api03-test-key" },
    };
    const provConfig = buildConfig(config);
    expect(provConfig.installablePlugins).not.toContain("slack");

    const channelCmds = provConfig.configSetCommands.filter(
      (c) => c.key.startsWith("channels.slack"),
    );
    expect(channelCmds.length).toBeGreaterThan(0);
  });

  it("plugin config generates config set commands for plugins.entries path", () => {
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
      depSecrets: { LINEAR_API_KEY: "lin_test", ANTHROPIC_API_KEY: "sk-ant-api03-test-key" },
    };
    const provConfig = buildConfig(config);
    const pluginCmds = provConfig.configSetCommands.filter(
      (c) => c.key.startsWith("plugins.entries.openclaw-linear"),
    );
    expect(pluginCmds.length).toBeGreaterThan(0);

    const teamIdCmd = pluginCmds.find((c) => c.key.includes("teamId"));
    expect(teamIdCmd).toBeTruthy();
    expect(teamIdCmd!.value).toBe("TEAM-456");
  });

  it("postProvision hooks are base64 encoded, preStart hooks come after config", () => {
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
    const provConfig = buildConfig(config);

    expect(provConfig.postProvisionHooks.length).toBe(1);
    expect(provConfig.postProvisionHooks[0].name).toBe("test-plugin");
    const decoded = Buffer.from(provConfig.postProvisionHooks[0].script, "base64").toString();
    expect(decoded).toContain("POST_PROVISION_MARKER");

    expect(provConfig.preStartHooks.length).toBe(1);
    const preDecoded = Buffer.from(provConfig.preStartHooks[0].script, "base64").toString();
    expect(preDecoded).toContain("PRE_START_MARKER");

    // In the template, post_provision hooks come before config, pre_start after
    const script = generateScript(config);
    const hooksPostIdx = script.indexOf("phase_hooks_post_provision");
    const configIdx = script.indexOf("phase_config");
    const hooksPreIdx = script.indexOf("phase_hooks_pre_start");
    expect(hooksPostIdx).toBeLessThan(configIdx);
    expect(hooksPreIdx).toBeGreaterThan(configIdx);
  });

  it("dep install + post-install scripts are base64 encoded; Brave search in config", () => {
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
      depSecrets: {
        BRAVE_API_KEY: "brave-key-test",
        GITHUB_TOKEN: "ghp_test",
        ANTHROPIC_API_KEY: "sk-ant-api03-test-key",
      },
    };
    const provConfig = buildConfig(config);

    // Root-level install script encoded
    expect(provConfig.depsRoot.length).toBe(1);
    const installDecoded = Buffer.from(provConfig.depsRoot[0].script, "base64").toString();
    expect(installDecoded).toContain("MARKER_GH_INSTALL");

    // Post-install script encoded
    expect(provConfig.depsPostInstall.length).toBe(1);
    const postDecoded = Buffer.from(provConfig.depsPostInstall[0].script, "base64").toString();
    expect(postDecoded).toContain("MARKER_GH_POST_INSTALL");

    // Brave search in config set commands
    const braveCmds = provConfig.configSetCommands.filter(
      (c) => c.key === "tools.web.search",
    );
    expect(braveCmds.length).toBe(1);
    expect(braveCmds[0].value).toEqual({ provider: "brave", apiKey: "brave-key-test" });
  });
});

// ---------------------------------------------------------------------------
// 6. Plugin internalKeys filtering
// ---------------------------------------------------------------------------

describe("cloud-init pipeline — internalKeys filtering", () => {
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
            agentMapping: { "uuid-1234": "default" },   // valid — should remain
            stateActions: { started: "add" },            // valid — should remain
          },
          secretEnvVars: {
            apiKey: "LINEAR_API_KEY",
            webhookSecret: "LINEAR_WEBHOOK_SECRET",
            linearUserUuid: "LINEAR_USER_UUID",         // internalKey — should be filtered
          },
          internalKeys: ["agentId", "linearUserUuid"],
        },
      ],
      depSecrets: {
        LINEAR_API_KEY: "lin_api_test",
        LINEAR_WEBHOOK_SECRET: "whsec_test",
        LINEAR_USER_UUID: "uuid-1234",
        ANTHROPIC_API_KEY: "sk-ant-api03-test-key",
      },
    };
    const provConfig = buildConfig(config);
    const cmds = provConfig.configSetCommands;

    // Valid secrets should be present
    expect(cmds.some((c) => c.key.includes("config.apiKey"))).toBe(true);
    expect(cmds.some((c) => c.key.includes("config.webhookSecret"))).toBe(true);

    // Valid config properties should be present
    expect(cmds.some((c) => c.key.includes("config.agentMapping"))).toBe(true);
    expect(cmds.some((c) => c.key.includes("config.stateActions"))).toBe(true);

    // Internal keys should NOT appear
    expect(cmds.some((c) => c.key.includes("config.agentId"))).toBe(false);
    expect(cmds.some((c) => c.key.includes("config.linearUserUuid"))).toBe(false);
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
      depSecrets: {
        SLACK_BOT_TOKEN: "xoxb-test",
        SLACK_APP_TOKEN: "xapp-test",
        ANTHROPIC_API_KEY: "sk-ant-api03-test-key",
      },
    };
    const provConfig = buildConfig(config);
    const cmds = provConfig.configSetCommands;

    // Valid secrets
    expect(cmds.some((c) => c.key === "channels.slack.botToken")).toBe(true);
    expect(cmds.some((c) => c.key === "channels.slack.appToken")).toBe(true);

    // Valid config
    expect(cmds.some((c) => c.key === "channels.slack.mode")).toBe(true);

    // Internal key should NOT appear
    expect(cmds.some((c) => c.key === "channels.slack.agentId")).toBe(false);
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
      depSecrets: { TEST_TOKEN: "tok_test", ANTHROPIC_API_KEY: "sk-ant-api03-test-key" },
    };
    const provConfig = buildConfig(config);
    const cmds = provConfig.configSetCommands;

    expect(cmds.some((c) => c.key.includes("config.someKey"))).toBe(true);
    expect(cmds.some((c) => c.key.includes("config.token"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Compression
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
