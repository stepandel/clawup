/**
 * Tests for provider-aware cloud-init generation.
 *
 * Verifies that generateCloudInit produces correct env var exports
 * for different model providers (Anthropic, OpenAI, Google, OpenRouter).
 */

import { describe, it, expect } from "vitest";
import { generateCloudInit, type CloudInitConfig } from "../cloud-init";

const BASE_CONFIG: CloudInitConfig = {
  anthropicApiKey: "test-api-key",
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
      modelProvider: "openrouter",
      model: "openrouter/auto",
    });
    expect(script).toContain("OPENROUTER_API_KEY");
    expect(script).toContain("openrouter provider");
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("throws on unknown model provider", () => {
    expect(() =>
      generateCloudInit({
        ...BASE_CONFIG,
        modelProvider: "unknown-provider",
      })
    ).toThrow(/Unknown model provider "unknown-provider"/);
  });

  it("uses anthropic flow when modelProvider is undefined", () => {
    const config = { ...BASE_CONFIG };
    delete config.modelProvider;
    const script = generateCloudInit(config);
    expect(script).toContain("Auto-detect Anthropic credential type");
  });
});
