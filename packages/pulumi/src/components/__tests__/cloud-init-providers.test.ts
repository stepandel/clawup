/**
 * Tests for provider-aware cloud-init generation.
 *
 * Verifies that buildProvisionerConfig produces correct env vars, config
 * set commands, and onboard flags for different model providers
 * (Anthropic, OpenAI, Google, OpenRouter).
 */

import { describe, it, expect } from "vitest";
import { generateCloudInit, type CloudInitConfig } from "../cloud-init";
import { buildProvisionerConfig, type ProvisionerConfig, type ConfigSetCommand } from "../provisioner-config";

const BASE_CONFIG: CloudInitConfig = {
  providerApiKeys: { anthropic: "test-api-key" },
  tailscaleAuthKey: "tskey-auth-test",
  gatewayToken: "gw-token-test",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: {},
  skipTailscale: true,
};

/** Extract the CONFIG_JSON heredoc from a generated script */
function extractConfigJson(script: string): ProvisionerConfig {
  const match = script.match(/cat <<'__CLAWUP_CONFIG__'\n([\s\S]*?)\n__CLAWUP_CONFIG__/);
  expect(match, "Expected __CLAWUP_CONFIG__ heredoc in script").toBeTruthy();
  return JSON.parse(match![1]);
}

/** Find config set commands matching a key pattern */
function findCmds(cmds: ConfigSetCommand[], pattern: string): ConfigSetCommand[] {
  return cmds.filter((c) => c.key.includes(pattern));
}

describe("cloud-init providers — env vars in provisioner config", () => {
  it("exports ANTHROPIC_API_KEY for anthropic provider (default)", () => {
    const config = buildProvisionerConfig(BASE_CONFIG);
    expect(config.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("test-api-key");
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBeUndefined();

    // Also in config set commands
    const envCmds = findCmds(config.configSetCommands, "env.ANTHROPIC_API_KEY");
    expect(envCmds.length).toBe(1);
  });

  it("exports ANTHROPIC_API_KEY when modelProvider is explicitly 'anthropic'", () => {
    const config = buildProvisionerConfig({ ...BASE_CONFIG, modelProvider: "anthropic" });
    expect(config.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("test-api-key");
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBeUndefined();
  });

  it("exports OPENAI_API_KEY for openai provider", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-test-openai" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
    });
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-test-openai");
    expect(config.profileEnvVars["ANTHROPIC_API_KEY"]).toBeUndefined();

    const envCmds = findCmds(config.configSetCommands, "env.OPENAI_API_KEY");
    expect(envCmds.length).toBe(1);
  });

  it("exports GOOGLE_API_KEY for google provider", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { google: "google-test-key" },
      modelProvider: "google",
      model: "google/gemini-2.5-pro",
    });
    expect(config.profileEnvVars["GOOGLE_API_KEY"]).toBe("google-test-key");

    const envCmds = findCmds(config.configSetCommands, "env.GOOGLE_API_KEY");
    expect(envCmds.length).toBe(1);
  });

  it("exports OPENROUTER_API_KEY for openrouter provider", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/auto",
    });
    expect(config.profileEnvVars["OPENROUTER_API_KEY"]).toBe("sk-or-test");

    const envCmds = findCmds(config.configSetCommands, "env.OPENROUTER_API_KEY");
    expect(envCmds.length).toBe(1);
  });

  it("uses anthropic flow when modelProvider is undefined", () => {
    const config = { ...BASE_CONFIG };
    delete config.modelProvider;
    const provConfig = buildProvisionerConfig(config);
    expect(provConfig.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("test-api-key");
    expect(provConfig.onboard.command).toContain("--anthropic-api-key");
  });

  it("exports env vars for multiple providers (primary + backup)", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test", anthropic: "sk-ant-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
      backupModel: "anthropic/claude-sonnet-4-5",
    });
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-openai-test");
    expect(config.profileEnvVars["ANTHROPIC_API_KEY"]).toBe("sk-ant-test");
  });

  it("works with openai-only deploy (no anthropic key)", () => {
    const config = buildProvisionerConfig({
      providerApiKeys: { openai: "sk-openai-test" },
      tailscaleAuthKey: "tskey-auth-test",
      gatewayToken: "gw-token-test",
      model: "openai/gpt-4o",
      modelProvider: "openai",
      codingAgent: "claude-code",
      workspaceFiles: {},
      skipTailscale: true,
    });
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-openai-test");
    expect(config.profileEnvVars["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("aliases OPENROUTER_API_KEY to OPENAI_API_KEY when codex + openrouter", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/openai/gpt-5.2",
      codingAgent: "codex",
    });
    expect(config.profileEnvVars["OPENROUTER_API_KEY"]).toBe("sk-or-test");
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-or-test");
    expect(config.profileEnvVars["OPENAI_BASE_URL"]).toBe("https://openrouter.ai/api/v1");

    // Config set commands should have the alias
    const aliasCmds = config.configSetCommands.filter(
      (c) => c.key === "env.OPENAI_API_KEY" && c.comment?.includes("Aliased"),
    );
    expect(aliasCmds.length).toBe(1);
  });

  it("does not alias when claude-code + openrouter", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/auto",
      codingAgent: "claude-code",
    });
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBeUndefined();
  });

  it("does not alias when codex + direct openai", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
      codingAgent: "codex",
    });
    const aliasCmds = config.configSetCommands.filter(
      (c) => c.comment?.includes("Aliased OPENROUTER"),
    );
    expect(aliasCmds.length).toBe(0);
  });
});

describe("cloud-init providers — onboard command flags", () => {
  it("anthropic provider uses --anthropic-api-key flag", () => {
    const config = buildProvisionerConfig(BASE_CONFIG);
    expect(config.onboard.command).toContain("openclaw onboard --non-interactive");
    expect(config.onboard.command).toContain("--anthropic-api-key");
  });

  it("openai provider uses --openai-api-key flag", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
    });
    expect(config.onboard.command).toContain("openclaw onboard --non-interactive");
    expect(config.onboard.command).toContain("--openai-api-key");
  });

  it("google provider uses --gemini-api-key flag", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { google: "google-test" },
      modelProvider: "google",
      model: "google/gemini-2.5-pro",
    });
    expect(config.onboard.command).toContain("openclaw onboard --non-interactive");
    expect(config.onboard.command).toContain("--gemini-api-key");
    expect(config.onboard.command).toContain("--auth-choice gemini-api-key");
  });

  it("openrouter provider uses --token-provider openrouter flag", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/auto",
    });
    expect(config.onboard.command).toContain("openclaw onboard --non-interactive");
    expect(config.onboard.command).toContain("--token-provider openrouter");
    expect(config.onboard.command).toContain("--auth-choice apiKey");
  });
});

describe("cloud-init providers — end-to-end script verification", () => {
  it("generated script embeds config with correct provider env vars", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-e2e" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
    });
    const extracted = extractConfigJson(script);
    expect(extracted.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-openai-e2e");
    expect(extracted.onboard.command).toContain("--openai-api-key");
  });

  it("generated script has phase functions and helpers", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).toContain("#!/bin/bash");
    expect(script).toContain("cfg()");
    expect(script).toContain("phase_onboard");
    expect(script).toContain("phase_env_vars");
    expect(script).toContain("phase_config");
  });
});
