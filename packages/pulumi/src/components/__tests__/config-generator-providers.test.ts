/**
 * Tests for provider-aware provisioner config generation.
 *
 * Verifies that buildProvisionerConfig produces correct config set commands,
 * env vars, and onboard flags for different model providers.
 */

import { describe, it, expect } from "vitest";
import { buildProvisionerConfig, type ConfigSetCommand } from "../provisioner-config";
import type { CloudInitConfig } from "../cloud-init";

const BASE_CONFIG: CloudInitConfig = {
  providerApiKeys: { anthropic: "sk-ant-api03-test-key" },
  tailscaleAuthKey: "tskey-auth-test",
  gatewayToken: "test-gw-token",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: {},
  skipTailscale: true,
};

/** Helper to find config set commands by key pattern */
function findCmds(cmds: ConfigSetCommand[], pattern: string): ConfigSetCommand[] {
  return cmds.filter((c) => c.key.includes(pattern));
}

describe("buildProvisionerConfig — provider-aware config", () => {
  it("sets Anthropic API key env var for anthropic/ models", () => {
    const config = buildProvisionerConfig(BASE_CONFIG);
    const envCmds = findCmds(config.configSetCommands, "env.ANTHROPIC_API_KEY");
    expect(envCmds.length).toBe(1);
    expect(envCmds[0].value).toBe("sk-ant-api03-test-key");
  });

  it("detects Anthropic OAuth token (sk-ant-oat prefix)", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { anthropic: "sk-ant-oat-subscription-token" },
    });
    const oauthCmds = findCmds(config.configSetCommands, "env.CLAUDE_CODE_OAUTH_TOKEN");
    expect(oauthCmds.length).toBe(1);
    expect(oauthCmds[0].value).toBe("sk-ant-oat-subscription-token");

    // Should NOT have ANTHROPIC_API_KEY
    const apiKeyCmds = findCmds(config.configSetCommands, "env.ANTHROPIC_API_KEY");
    expect(apiKeyCmds.length).toBe(0);

    // Profile env should also use CLAUDE_CODE_OAUTH_TOKEN
    expect(config.profileEnvVars["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("sk-ant-oat-subscription-token");
    expect(config.profileEnvVars["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("sets OpenAI env var for openai/ models", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
    });
    const envCmds = findCmds(config.configSetCommands, "env.OPENAI_API_KEY");
    expect(envCmds.length).toBe(1);
    expect(envCmds[0].value).toBe("sk-openai-test");

    // Should NOT have Anthropic env
    expect(findCmds(config.configSetCommands, "env.ANTHROPIC_API_KEY").length).toBe(0);
  });

  it("sets Google env var for google/ models", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { google: "google-test-key" },
      modelProvider: "google",
      model: "google/gemini-2.5-pro",
    });
    const envCmds = findCmds(config.configSetCommands, "env.GOOGLE_API_KEY");
    expect(envCmds.length).toBe(1);
    expect(envCmds[0].value).toBe("google-test-key");
  });

  it("sets OpenRouter env var for openrouter/ models", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/openai/gpt-4o",
    });
    const envCmds = findCmds(config.configSetCommands, "env.OPENROUTER_API_KEY");
    expect(envCmds.length).toBe(1);
    expect(envCmds[0].value).toBe("sk-or-test");
  });

  it("sets correct model in config for non-Anthropic providers", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/o3",
    });
    const modelCmds = config.configSetCommands.filter(
      (c) => c.type === "models_set" || c.key === "agents.defaults.model",
    );
    expect(modelCmds.length).toBe(1);
    expect(modelCmds[0].value).toBe("openai/o3");
  });

  it("handles backup model with same provider (no duplicate env)", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
      backupModel: "openai/o4-mini",
    });

    // Model should use primary+fallbacks format
    const modelCmd = config.configSetCommands.find(
      (c) => c.key === "agents.defaults.model",
    );
    expect(modelCmd).toBeTruthy();
    expect(modelCmd!.value).toEqual({
      primary: "openai/gpt-4o",
      fallbacks: ["openai/o4-mini"],
    });

    // Only one OPENAI_API_KEY env
    const envCmds = findCmds(config.configSetCommands, "env.OPENAI_API_KEY");
    expect(envCmds.length).toBe(1);
  });

  it("handles backup model with different provider (cross-provider fallback)", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test", anthropic: "sk-ant-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
      backupModel: "anthropic/claude-sonnet-4-5",
    });

    // Both provider env vars should be set
    expect(findCmds(config.configSetCommands, "env.OPENAI_API_KEY").length).toBe(1);
    expect(findCmds(config.configSetCommands, "env.ANTHROPIC_API_KEY").length).toBeGreaterThanOrEqual(1);

    // Model should have fallbacks
    const modelCmd = config.configSetCommands.find(
      (c) => c.key === "agents.defaults.model",
    );
    expect(modelCmd!.value).toEqual({
      primary: "openai/gpt-4o",
      fallbacks: ["anthropic/claude-sonnet-4-5"],
    });
  });

  it("does not add backup provider section when same as primary", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      backupModel: "anthropic/claude-sonnet-4-5",
    });
    // Should NOT have a "Backup model provider" comment
    const backupCmds = config.configSetCommands.filter(
      (c) => c.comment?.includes("Backup model provider"),
    );
    expect(backupCmds.length).toBe(0);
  });
});

describe("buildProvisionerConfig — Codex coding agent", () => {
  it("includes Codex CLI backend config", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      codingAgent: "codex",
    });
    const backendCmd = config.configSetCommands.find(
      (c) => c.key === "agents.defaults.cliBackends",
    );
    expect(backendCmd).toBeTruthy();
    expect(backendCmd!.comment).toContain("codex");

    // Codex backend should have command=codex and args containing exec, full-auto
    const backends = backendCmd!.value as Record<string, Record<string, unknown>>;
    const claudeCli = backends["claude-cli"];
    expect(claudeCli).toBeTruthy();
    expect(claudeCli.command).toBe("codex");
    expect(claudeCli.args).toContain("exec");
    expect(claudeCli.args).toContain("--full-auto");
  });

  it("includes Claude Code CLI backend config (default)", () => {
    const config = buildProvisionerConfig(BASE_CONFIG);
    const backendCmd = config.configSetCommands.find(
      (c) => c.key === "agents.defaults.cliBackends",
    );
    expect(backendCmd).toBeTruthy();
    expect(backendCmd!.comment).toContain("claude-code");

    const backends = backendCmd!.value as Record<string, Record<string, unknown>>;
    const claudeCli = backends["claude-cli"];
    expect(claudeCli).toBeTruthy();
    expect(claudeCli.command).toBe("claude");
  });

  it("aliases OPENROUTER_API_KEY to OPENAI_API_KEY when codex + openrouter", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/openai/gpt-5.2",
      codingAgent: "codex",
    });

    // Should have OPENAI_API_KEY aliased from OPENROUTER
    const aliasCmds = config.configSetCommands.filter(
      (c) => c.key === "env.OPENAI_API_KEY" && c.comment?.includes("Aliased"),
    );
    expect(aliasCmds.length).toBe(1);
    expect(aliasCmds[0].value).toBe("sk-or-test");

    // Should have OPENAI_BASE_URL
    const baseCmds = findCmds(config.configSetCommands, "env.OPENAI_BASE_URL");
    expect(baseCmds.length).toBe(1);
    expect(baseCmds[0].value).toBe("https://openrouter.ai/api/v1");

    // Profile env vars should also have the alias
    expect(config.profileEnvVars["OPENAI_API_KEY"]).toBe("sk-or-test");
    expect(config.profileEnvVars["OPENAI_BASE_URL"]).toBe("https://openrouter.ai/api/v1");
  });

  it("does not alias OPENAI_API_KEY when codex + direct openai", () => {
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

  it("does not alias OPENAI_API_KEY when claude-code + openrouter", () => {
    const config = buildProvisionerConfig({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/openai/gpt-4o",
      codingAgent: "claude-code",
    });
    const aliasCmds = config.configSetCommands.filter(
      (c) => c.comment?.includes("Aliased OPENROUTER"),
    );
    expect(aliasCmds.length).toBe(0);
  });
});
