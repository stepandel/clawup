/**
 * Tests for provider-aware cloud-init generation.
 *
 * Verifies that generateCloudInit produces correct .profile exports
 * and writes the pre-built openclaw.json from providerEnv.
 */

import { describe, it, expect } from "vitest";
import { generateCloudInit, type CloudInitConfig } from "../cloud-init";

/** Minimal openclaw.json for test fixtures */
function minimalJson(token: string, env: Record<string, string> = {}): string {
  return JSON.stringify({
    gateway: { port: 18789, mode: "local", trustedProxies: ["127.0.0.1"],
      controlUi: { enabled: true, allowInsecureAuth: true },
      auth: { mode: "token", token } },
    env,
    agents: { defaults: { heartbeat: { every: "1m", session: "main" } } },
    acp: { defaultAgent: "default" },
  }, null, 2);
}

const BASE_CONFIG: CloudInitConfig = {
  openclawConfigJson: minimalJson("gw-token-test", { ANTHROPIC_API_KEY: "test-api-key" }),
  providerEnv: { ANTHROPIC_API_KEY: "test-api-key" },
  providerApiKeys: { anthropic: "test-api-key" },
  tailscaleAuthKey: "tskey-auth-test",
  gatewayToken: "gw-token-test",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  workspaceFiles: {},
  skipTailscale: true,
};

describe("generateCloudInit — provider env var exports", () => {
  it("exports ANTHROPIC_API_KEY from providerEnv to .profile", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).toContain('export ANTHROPIC_API_KEY=');
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("exports CLAUDE_CODE_OAUTH_TOKEN when OAuth key in providerEnv", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      openclawConfigJson: minimalJson("gw-token-test", { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" }),
      providerEnv: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" },
    });
    expect(script).toContain('export CLAUDE_CODE_OAUTH_TOKEN=');
    expect(script).not.toContain("ANTHROPIC_API_KEY");
  });

  it("exports OPENAI_API_KEY for OpenAI provider", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      openclawConfigJson: minimalJson("gw-token-test", { OPENAI_API_KEY: "sk-openai-test" }),
      providerEnv: { OPENAI_API_KEY: "sk-openai-test" },
      providerApiKeys: { openai: "sk-openai-test" },
      model: "openai/gpt-4o",
    });
    expect(script).toContain("OPENAI_API_KEY");
  });

  it("exports GOOGLE_API_KEY for Google provider", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      openclawConfigJson: minimalJson("gw-token-test", { GOOGLE_API_KEY: "google-test-key" }),
      providerEnv: { GOOGLE_API_KEY: "google-test-key" },
      providerApiKeys: { google: "google-test-key" },
      model: "google/gemini-2.5-pro",
    });
    expect(script).toContain("GOOGLE_API_KEY");
  });

  it("exports OPENROUTER_API_KEY for OpenRouter provider", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      openclawConfigJson: minimalJson("gw-token-test", { OPENROUTER_API_KEY: "sk-or-test" }),
      providerEnv: { OPENROUTER_API_KEY: "sk-or-test" },
      providerApiKeys: { openrouter: "sk-or-test" },
      model: "openrouter/auto",
    });
    expect(script).toContain("OPENROUTER_API_KEY");
  });

  it("exports multiple provider env vars for multi-provider configs", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      openclawConfigJson: minimalJson("gw-token-test", {
        OPENAI_API_KEY: "sk-openai-test",
        ANTHROPIC_API_KEY: "sk-ant-test",
      }),
      providerEnv: { OPENAI_API_KEY: "sk-openai-test", ANTHROPIC_API_KEY: "sk-ant-test" },
      providerApiKeys: { openai: "sk-openai-test", anthropic: "sk-ant-test" },
      model: "openai/gpt-4o",
    });
    expect(script).toContain("OPENAI_API_KEY");
    expect(script).toContain("ANTHROPIC_API_KEY");
  });
});

describe("generateCloudInit — JSON config writing", () => {
  it("writes openclaw.json via OPENCLAW_CONFIG heredoc", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).toContain("Writing openclaw.json");
    expect(script).toContain("OPENCLAW_CONFIG");
    expect(script).toContain("Created openclaw.json");
  });

  it("does NOT contain Python heredoc or openclaw onboard", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).not.toContain("PYTHON_SCRIPT");
    expect(script).not.toContain("python3 <<");
    expect(script).not.toContain("openclaw onboard");
    expect(script).not.toContain("openclaw doctor");
  });

  it("embeds the provided JSON in the heredoc", () => {
    const script = generateCloudInit(BASE_CONFIG);
    // The JSON should appear between OPENCLAW_CONFIG heredoc markers
    const match = script.match(/cat > .*openclaw\.json << 'OPENCLAW_CONFIG'\n([\s\S]*?)\nOPENCLAW_CONFIG/);
    expect(match).toBeTruthy();
    const embedded = JSON.parse(match![1]);
    expect(embedded.gateway.auth.token).toBe("gw-token-test");
  });
});

describe("generateCloudInit — no bash-level OAuth or aliasing", () => {
  it("does not contain bash-level OAuth detection", () => {
    const script = generateCloudInit(BASE_CONFIG);
    expect(script).not.toContain("sk-ant-oat");
    expect(script).not.toContain("Auto-detect Anthropic");
  });

  it("does not contain bash-level Codex aliasing", () => {
    const script = generateCloudInit({
      ...BASE_CONFIG,
      openclawConfigJson: minimalJson("gw-token-test", { OPENROUTER_API_KEY: "sk-or-test" }),
      providerEnv: { OPENROUTER_API_KEY: "sk-or-test" },
      providerApiKeys: { openrouter: "sk-or-test" },
      model: "openrouter/auto",
      codingAgent: "codex",
    });
    expect(script).not.toContain("Aliased OPENROUTER_API_KEY");
  });
});
