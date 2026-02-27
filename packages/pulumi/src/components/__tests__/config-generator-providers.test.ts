/**
 * Tests for provider-aware config generation.
 *
 * Verifies that generateConfigPatchBash produces correct bash
 * config patching for different model providers.
 */

import { describe, it, expect } from "vitest";
import { generateConfigPatchBash, type OpenClawConfigOptions } from "../config-generator";

const BASE_OPTIONS: OpenClawConfigOptions = {
  gatewayToken: "test-gw-token",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  plugins: [],
};

describe("generateConfigPatchBash — provider-aware config", () => {
  it("generates Anthropic auto-detect for anthropic/ models", () => {
    const script = generateConfigPatchBash(BASE_OPTIONS);
    expect(script).toContain("Anthropic: auto-detect credential type");
    expect(script).toContain('ANTHROPIC_API_KEY');
    expect(script).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(script).toContain('sk-ant-oat');
  });

  it("generates OpenAI env var config for openai/ models", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
    });
    expect(script).toContain("OpenAI: set provider API key env var");
    expect(script).toContain('OPENAI_API_KEY');
    expect(script).not.toContain("auto-detect credential type");
  });

  it("generates Google env var config for google/ models", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "google/gemini-2.5-pro",
    });
    expect(script).toContain("Google Gemini: set provider API key env var");
    expect(script).toContain('GOOGLE_API_KEY');
  });

  it("generates OpenRouter env var config for openrouter/ models", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-4o",
    });
    expect(script).toContain("OpenRouter: set provider API key env var");
    expect(script).toContain('OPENROUTER_API_KEY');
  });

  it("throws on unknown provider model prefix", () => {
    expect(() =>
      generateConfigPatchBash({
        ...BASE_OPTIONS,
        model: "mistral/large",
      })
    ).toThrow(/Unknown model provider "mistral"/);
  });

  it("sets correct model in config for non-Anthropic providers", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openai/o3",
    });
    expect(script).toContain('"openai/o3"');
  });

  it("handles backup model with same provider", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      backupModel: "openai/o4-mini",
    });
    expect(script).toContain('"openai/gpt-4o"');
    expect(script).toContain('"openai/o4-mini"');
    expect(script).toContain('OPENAI_API_KEY');
  });

  it("handles backup model with different provider (cross-provider fallback)", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      backupModel: "anthropic/claude-sonnet-4-5",
    });
    expect(script).toContain('"openai/gpt-4o"');
    expect(script).toContain('"anthropic/claude-sonnet-4-5"');
    expect(script).toContain('OPENAI_API_KEY');
    // Should also set ANTHROPIC_API_KEY for the backup provider
    expect(script).toContain('ANTHROPIC_API_KEY');
    expect(script).toContain("Backup model provider");
  });

  it("does not add backup provider section when same as primary", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "anthropic/claude-opus-4-6",
      backupModel: "anthropic/claude-sonnet-4-5",
    });
    expect(script).not.toContain("Backup model provider");
  });
});

describe("generateConfigPatchBash — Codex coding agent", () => {
  it("includes Codex CLI backend config", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      codingAgent: "codex",
    });
    expect(script).toContain('"codex"');
    expect(script).toContain("exec");
    expect(script).toContain("full-auto");
  });

  it("includes Claude Code CLI backend config (default)", () => {
    const script = generateConfigPatchBash(BASE_OPTIONS);
    expect(script).toContain('"claude"');
    expect(script).toContain("code");
  });

  it("aliases OPENROUTER_API_KEY to OPENAI_API_KEY when codex + openrouter", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-5.2",
      codingAgent: "codex",
    });
    expect(script).toContain('OPENROUTER_API_KEY');
    expect(script).toContain('openclaw config set env.OPENAI_API_KEY');
    expect(script).toContain('openclaw config set env.OPENAI_BASE_URL');
    expect(script).toContain("https://openrouter.ai/api/v1");
    expect(script).toContain("Aliased OPENROUTER_API_KEY -> OPENAI_API_KEY");
  });

  it("does not alias OPENAI_API_KEY when codex + direct openai", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      codingAgent: "codex",
    });
    expect(script).not.toContain("Aliased OPENROUTER_API_KEY");
  });

  it("does not alias OPENAI_API_KEY when claude-code + openrouter", () => {
    const script = generateConfigPatchBash({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-4o",
      codingAgent: "claude-code",
    });
    expect(script).not.toContain("Aliased OPENROUTER_API_KEY");
  });
});
