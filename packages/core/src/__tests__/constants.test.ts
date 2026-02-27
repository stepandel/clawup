import { describe, it, expect } from "vitest";
import { MODEL_PROVIDERS, KEY_INSTRUCTIONS, getProviderForModel } from "../constants";

describe("MODEL_PROVIDERS", () => {
  it("has entries for anthropic, openai, google, openrouter", () => {
    expect(MODEL_PROVIDERS.anthropic).toBeDefined();
    expect(MODEL_PROVIDERS.openai).toBeDefined();
    expect(MODEL_PROVIDERS.google).toBeDefined();
    expect(MODEL_PROVIDERS.openrouter).toBeDefined();
  });

  it("each entry has name, envVar, keyPrefix, and models", () => {
    for (const [key, provider] of Object.entries(MODEL_PROVIDERS)) {
      expect(provider.name).toBeTruthy();
      expect(provider.envVar).toBeTruthy();
      expect(typeof provider.keyPrefix).toBe("string");
      expect(Array.isArray(provider.models)).toBe(true);
    }
  });

  it("openai envVar is OPENAI_API_KEY", () => {
    expect(MODEL_PROVIDERS.openai.envVar).toBe("OPENAI_API_KEY");
  });

  it("google has no key prefix", () => {
    expect(MODEL_PROVIDERS.google.keyPrefix).toBe("");
  });

  it("openrouter has empty models array", () => {
    expect(MODEL_PROVIDERS.openrouter.models).toHaveLength(0);
  });
});

describe("KEY_INSTRUCTIONS", () => {
  it("has instructions for all provider API keys", () => {
    expect(KEY_INSTRUCTIONS.anthropicApiKey).toBeDefined();
    expect(KEY_INSTRUCTIONS.openaiApiKey).toBeDefined();
    expect(KEY_INSTRUCTIONS.googleApiKey).toBeDefined();
    expect(KEY_INSTRUCTIONS.openrouterApiKey).toBeDefined();
  });

  it("each instruction has title and steps", () => {
    for (const key of ["anthropicApiKey", "openaiApiKey", "googleApiKey", "openrouterApiKey"] as const) {
      expect(KEY_INSTRUCTIONS[key].title).toBeTruthy();
      expect(KEY_INSTRUCTIONS[key].steps.length).toBeGreaterThan(0);
    }
  });
});

describe("getProviderForModel", () => {
  it("extracts anthropic from anthropic/claude-opus-4-6", () => {
    expect(getProviderForModel("anthropic/claude-opus-4-6")).toBe("anthropic");
  });

  it("extracts openai from openai/gpt-4o", () => {
    expect(getProviderForModel("openai/gpt-4o")).toBe("openai");
  });

  it("extracts google from google/gemini-2.5-pro", () => {
    expect(getProviderForModel("google/gemini-2.5-pro")).toBe("google");
  });

  it("returns unknown for unknown/foo", () => {
    expect(getProviderForModel("unknown/foo")).toBe("unknown");
  });

  it("returns full string when no slash present", () => {
    expect(getProviderForModel("gpt-4o")).toBe("gpt-4o");
  });

  it("handles multiple slashes by splitting on first", () => {
    expect(getProviderForModel("openai/gpt-4o/latest")).toBe("openai");
  });
});
