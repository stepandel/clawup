/**
 * Tests for provider-aware cloud-init generation.
 *
 * Verifies that generateCloudInit produces correct env var exports
 * for different model providers (Anthropic, OpenAI, Google, OpenRouter)
 * and that openclaw onboard is invoked with correct provider-specific flags.
 */

import { describe, it, expect } from "vitest";
import { generateCloudInit, type CloudInitConfig } from "../cloud-init";

const BASE_CONFIG: CloudInitConfig = {
  providerApiKeys: { anthropic: "test-api-key" },
  tailscaleAuthKey: "tskey-auth-test",
  gatewayToken: "gw-token-test",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: {},
  skipTailscale: true,
};

describe("generateCloudInit — provider-aware env vars", () => {
  it("exports ANTHROPIC_API_KEY with auto-detect for anthropic provider (default)", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).toContain("Auto-detect Anthropic credential type");
    expect(script).toContain('ANTHROPIC_API_KEY=');
    expect(script).toContain('CLAUDE_CODE_OAUTH_TOKEN=');
    expect(script).not.toContain("OPENAI_API_KEY");
  });

  it("exports ANTHROPIC_API_KEY when modelProvider is explicitly 'anthropic'", () => {
    const script = generateCloudInit({ ...BASE_CONFIG, modelProvider: "anthropic" });
    expect(script).toContain("Auto-detect Anthropic credential type");
    expect(script).not.toContain("OPENAI_API_KEY");
  });

  it("exports OPENAI_API_KEY for openai provider", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-test-openai" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
    });
    expect(script).toContain("OPENAI_API_KEY");
    expect(script).toContain("openai provider");
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("exports GOOGLE_API_KEY for google provider", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { google: "google-test-key" },
      modelProvider: "google",
      model: "google/gemini-2.5-pro",
    });
    expect(script).toContain("GOOGLE_API_KEY");
    expect(script).toContain("google provider");
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("exports OPENROUTER_API_KEY for openrouter provider", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/auto",
    });
    expect(script).toContain("OPENROUTER_API_KEY");
    expect(script).toContain("openrouter provider");
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("uses anthropic flow when modelProvider is undefined", () => {
    const config = { ...BASE_CONFIG };
    delete config.modelProvider;
    const script = generateCloudInit(config);
    expect(script).toContain("Auto-detect Anthropic credential type");
  });

  it("exports env vars for multiple providers (primary + backup)", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test", anthropic: "sk-ant-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
      backupModel: "anthropic/claude-sonnet-4-5",
    });
    expect(script).toContain("OPENAI_API_KEY");
    expect(script).toContain("ANTHROPIC_API_KEY");
  });

  it("works with openai-only deploy (no anthropic key)", () => {
    const script = generateCloudInit({
      providerApiKeys: { openai: "sk-openai-test" },
      tailscaleAuthKey: "tskey-auth-test",
      gatewayToken: "gw-token-test",
      model: "openai/gpt-4o",
      modelProvider: "openai",
      codingAgent: "claude-code",
      workspaceFiles: {},
      skipTailscale: true,
    });
    expect(script).toContain("OPENAI_API_KEY");
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("uses openclaw onboard for non-Anthropic providers with correct flags", () => {
    const script = generateCloudInit({
      providerApiKeys: { openai: "sk-openai-test" },
      tailscaleAuthKey: "tskey-auth-test",
      gatewayToken: "gw-token-test",
      model: "openai/gpt-5.3",
      modelProvider: "openai",
      codingAgent: "codex",
      workspaceFiles: {},
      skipTailscale: true,
    });
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("--openai-api-key");
  });

  it("uses openclaw onboard for anthropic provider with correct flags", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("--anthropic-api-key");
  });

  it("aliases OPENROUTER_API_KEY to OPENAI_API_KEY when codex + openrouter", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/openai/gpt-5.2",
      codingAgent: "codex",
    });
    expect(script).toContain("OPENROUTER_API_KEY");
    expect(script).toContain('OPENAI_API_KEY=');
    expect(script).toContain('OPENAI_BASE_URL="https://openrouter.ai/api/v1"');
    expect(script).toContain("Aliased OPENROUTER_API_KEY -> OPENAI_API_KEY");
  });

  it("does not alias when claude-code + openrouter", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/auto",
      codingAgent: "claude-code",
    });
    expect(script).not.toContain("Aliased OPENROUTER_API_KEY");
  });

  it("does not alias when codex + direct openai", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
      codingAgent: "codex",
    });
    expect(script).not.toContain("Aliased OPENROUTER_API_KEY");
  });
});

describe("generateCloudInit — openclaw onboard provider flags", () => {
  it("anthropic provider uses --anthropic-api-key flag", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("--anthropic-api-key");
  });

  it("openai provider uses --openai-api-key flag", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openai: "sk-openai-test" },
      modelProvider: "openai",
      model: "openai/gpt-4o",
    });
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("--openai-api-key");
  });

  it("google provider uses --gemini-api-key flag", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { google: "google-test" },
      modelProvider: "google",
      model: "google/gemini-2.5-pro",
    });
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("--gemini-api-key");
    expect(script).toContain("--auth-choice gemini-api-key");
  });

  it("openrouter provider uses --token-provider openrouter flag", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      providerApiKeys: { openrouter: "sk-or-test" },
      modelProvider: "openrouter",
      model: "openrouter/auto",
    });
    expect(script).toContain("openclaw onboard --non-interactive");
    expect(script).toContain("--token-provider openrouter");
    expect(script).toContain("--auth-choice apiKey");
  });
});
