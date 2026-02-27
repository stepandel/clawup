/**
 * Tests for provider-aware config generation.
 *
 * Verifies that generateConfigPatchScript produces correct Python
 * config patching for different model providers.
 */

import { describe, it, expect } from "vitest";
import { generateConfigPatchScript, type OpenClawConfigOptions } from "../config-generator";

const BASE_OPTIONS: OpenClawConfigOptions = {
  gatewayToken: "test-gw-token",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  plugins: [],
};

describe("generateConfigPatchScript — provider-aware config", () => {
  it("generates Anthropic auto-detect for anthropic/ models", () => {
    const script = generateConfigPatchScript(BASE_OPTIONS);
    expect(script).toContain("Anthropic: auto-detect credential type");
    expect(script).toContain('ANTHROPIC_API_KEY');
    expect(script).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(script).toContain('sk-ant-oat');
  });

  it("generates OpenAI env var config for openai/ models", () => {
    const script = generateConfigPatchScript({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
    });
    expect(script).toContain("OpenAI: set provider API key env var");
    expect(script).toContain('OPENAI_API_KEY');
    expect(script).not.toContain("auto-detect credential type");
  });

  it("generates Google env var config for google/ models", () => {
    const script = generateConfigPatchScript({
      ...BASE_OPTIONS,
      model: "google/gemini-2.5-pro",
    });
    expect(script).toContain("Google Gemini: set provider API key env var");
    expect(script).toContain('GOOGLE_API_KEY');
  });

  it("generates OpenRouter env var config for openrouter/ models", () => {
    const script = generateConfigPatchScript({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-4o",
    });
    expect(script).toContain("OpenRouter: set provider API key env var");
    expect(script).toContain('OPENROUTER_API_KEY');
  });

  it("throws on unknown provider model prefix", () => {
    expect(() =>
      generateConfigPatchScript({
        ...BASE_OPTIONS,
        model: "mistral/large",
      })
    ).toThrow(/Unknown model provider "mistral"/);
  });

  it("sets correct model in config for non-Anthropic providers", () => {
    const script = generateConfigPatchScript({
      ...BASE_OPTIONS,
      model: "openai/o3",
    });
    expect(script).toContain('"openai/o3"');
  });

  it("handles backup model with different provider", () => {
    const script = generateConfigPatchScript({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      backupModel: "openai/o4-mini",
    });
    expect(script).toContain('"openai/gpt-4o"');
    expect(script).toContain('"openai/o4-mini"');
    expect(script).toContain('OPENAI_API_KEY');
  });
});

describe("generateConfigPatchScript — Codex coding agent", () => {
  it("includes Codex CLI backend config", () => {
    const script = generateConfigPatchScript({
      ...BASE_OPTIONS,
      codingAgent: "codex",
    });
    expect(script).toContain('"codex"');
    expect(script).toContain("exec");
    expect(script).toContain("full-auto");
  });

  it("includes Claude Code CLI backend config (default)", () => {
    const script = generateConfigPatchScript(BASE_OPTIONS);
    expect(script).toContain('"claude"');
    expect(script).toContain("code");
  });
});
