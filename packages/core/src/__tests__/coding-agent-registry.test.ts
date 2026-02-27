/**
 * Tests for the coding agent registry — Codex entry.
 */

import { describe, it, expect } from "vitest";
import { CODING_AGENT_REGISTRY } from "../coding-agent-registry";

describe("CODING_AGENT_REGISTRY", () => {
  it("has claude-code entry", () => {
    expect(CODING_AGENT_REGISTRY["claude-code"]).toBeDefined();
    expect(CODING_AGENT_REGISTRY["claude-code"].displayName).toBe("Claude Code");
  });

  it("has codex entry", () => {
    expect(CODING_AGENT_REGISTRY.codex).toBeDefined();
    expect(CODING_AGENT_REGISTRY.codex.displayName).toBe("Codex (OpenAI)");
  });

  it("codex has OPENAI_API_KEY secret", () => {
    const codex = CODING_AGENT_REGISTRY.codex;
    expect(codex.secrets).toBeDefined();
    expect(codex.secrets.OpenaiApiKey).toBeDefined();
    expect(codex.secrets.OpenaiApiKey.envVar).toBe("OPENAI_API_KEY");
    expect(codex.secrets.OpenaiApiKey.scope).toBe("agent");
  });

  it("codex has install script with npm install", () => {
    expect(CODING_AGENT_REGISTRY.codex.installScript).toContain("npm install -g @openai/codex");
  });

  it("codex has configureModelScript", () => {
    expect(CODING_AGENT_REGISTRY.codex.configureModelScript).toContain("codex");
    expect(CODING_AGENT_REGISTRY.codex.configureModelScript).toContain("config.toml");
  });

  it("codex cliBackend uses codex command with full-auto", () => {
    const cli = CODING_AGENT_REGISTRY.codex.cliBackend;
    expect(cli.command).toBe("codex");
    expect(cli.args).toContain("exec");
    expect(cli.args).toContain("--full-auto");
    expect(cli.modelArg).toBe("--model");
  });

  it("all entries have required fields", () => {
    for (const [name, entry] of Object.entries(CODING_AGENT_REGISTRY)) {
      expect(entry.displayName).toBeTruthy();
      expect(entry.installScript).toBeTruthy();
      expect(entry.secrets).toBeDefined();
      expect(entry.cliBackend).toBeDefined();
      expect(entry.cliBackend.command).toBeTruthy();
    }
  });
});
