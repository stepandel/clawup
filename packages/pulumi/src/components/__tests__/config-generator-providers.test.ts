/**
 * Tests for provider-aware config generation.
 *
 * Verifies that generateFullOpenClawConfig produces correct
 * openclaw.json for different model providers.
 */

import { describe, it, expect } from "vitest";
import { generateFullOpenClawConfig, type FullOpenClawConfigOptions } from "../config-generator";

const BASE_OPTIONS: FullOpenClawConfigOptions = {
  gatewayToken: "test-gw-token",
  model: "anthropic/claude-opus-4-6",
  codingAgent: "claude-code",
  providerEnv: { ANTHROPIC_API_KEY: "sk-ant-api03-test" },
  plugins: [],
};

describe("generateFullOpenClawConfig — provider env vars", () => {
  it("includes Anthropic API key in env section", () => {
    const config = generateFullOpenClawConfig(BASE_OPTIONS);
    const env = config.env as Record<string, string>;
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-api03-test");
  });

  it("includes OAuth token when provided via providerEnv", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      providerEnv: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("sk-ant-oat-test");
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("includes OpenAI API key for OpenAI provider", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      providerEnv: { OPENAI_API_KEY: "sk-openai-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["OPENAI_API_KEY"]).toBe("sk-openai-test");
  });

  it("includes Google API key for Google provider", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "google/gemini-2.5-pro",
      providerEnv: { GOOGLE_API_KEY: "google-api-key-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["GOOGLE_API_KEY"]).toBe("google-api-key-test");
  });

  it("includes OpenRouter API key for OpenRouter provider", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-4o",
      providerEnv: { OPENROUTER_API_KEY: "sk-or-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["OPENROUTER_API_KEY"]).toBe("sk-or-test");
  });

  it("throws on unknown model provider", () => {
    expect(() =>
      generateFullOpenClawConfig({
        ...BASE_OPTIONS,
        model: "mistral/large",
        providerEnv: {},
      })
    ).toThrow(/Unknown model provider "mistral"/);
  });
});

describe("generateFullOpenClawConfig — model and fallbacks", () => {
  it("sets primary model as string when no backup", () => {
    const config = generateFullOpenClawConfig(BASE_OPTIONS);
    const defaults = (config.agents as any).defaults;
    expect(defaults.model).toBe("anthropic/claude-opus-4-6");
  });

  it("sets model with fallbacks when backup provided", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      backupModel: "anthropic/claude-sonnet-4-5",
      providerEnv: { OPENAI_API_KEY: "sk-openai-test", ANTHROPIC_API_KEY: "sk-ant-test" },
    });
    const defaults = (config.agents as any).defaults;
    expect(defaults.model.primary).toBe("openai/gpt-4o");
    expect(defaults.model.fallbacks).toEqual(["anthropic/claude-sonnet-4-5"]);
  });

  it("includes backup provider env when different from primary", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      backupModel: "anthropic/claude-sonnet-4-5",
      providerEnv: { OPENAI_API_KEY: "sk-openai-test", ANTHROPIC_API_KEY: "sk-ant-backup" },
    });
    const env = config.env as Record<string, string>;
    expect(env["OPENAI_API_KEY"]).toBe("sk-openai-test");
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-backup");
  });

  it("does not duplicate provider env when backup is same provider", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "anthropic/claude-opus-4-6",
      backupModel: "anthropic/claude-sonnet-4-5",
      providerEnv: { ANTHROPIC_API_KEY: "sk-ant-test" },
    });
    const env = config.env as Record<string, string>;
    expect(Object.keys(env).filter(k => k === "ANTHROPIC_API_KEY")).toHaveLength(1);
  });
});

describe("generateFullOpenClawConfig — Codex coding agent", () => {
  it("includes Codex CLI backend config", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      codingAgent: "codex",
    });
    const defaults = (config.agents as any).defaults;
    expect(defaults.cliBackends["claude-cli"]).toBeDefined();
  });

  it("includes Claude Code CLI backend config (default)", () => {
    const config = generateFullOpenClawConfig(BASE_OPTIONS);
    const defaults = (config.agents as any).defaults;
    expect(defaults.cliBackends["claude-cli"]).toBeDefined();
  });

  it("aliases OPENROUTER_API_KEY to OPENAI_API_KEY when codex + openrouter", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-5.2",
      codingAgent: "codex",
      providerEnv: { OPENROUTER_API_KEY: "sk-or-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["OPENAI_API_KEY"]).toBe("sk-or-test");
    expect(env["OPENAI_BASE_URL"]).toBe("https://openrouter.ai/api/v1");
  });

  it("does not alias when codex + direct openai", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openai/gpt-4o",
      codingAgent: "codex",
      providerEnv: { OPENAI_API_KEY: "sk-openai-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["OPENAI_BASE_URL"]).toBeUndefined();
  });

  it("does not alias when claude-code + openrouter", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      model: "openrouter/openai/gpt-4o",
      codingAgent: "claude-code",
      providerEnv: { OPENROUTER_API_KEY: "sk-or-test" },
    });
    const env = config.env as Record<string, string>;
    expect(env["OPENAI_API_KEY"]).toBeUndefined();
  });
});

describe("generateFullOpenClawConfig — gateway and structure", () => {
  it("generates correct gateway config", () => {
    const config = generateFullOpenClawConfig(BASE_OPTIONS);
    const gateway = config.gateway as any;
    expect(gateway.port).toBe(18789);
    expect(gateway.mode).toBe("local");
    expect(gateway.auth.mode).toBe("token");
    expect(gateway.auth.token).toBe("test-gw-token");
  });

  it("includes acp.defaultAgent", () => {
    const config = generateFullOpenClawConfig(BASE_OPTIONS);
    expect((config.acp as any).defaultAgent).toBe("default");
  });

  it("includes agent identity when agentName provided", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      agentName: "PM Agent",
      agentEmoji: "robot",
    });
    const list = (config.agents as any).list;
    expect(list).toBeDefined();
    expect(list[0].identity.name).toBe("PM Agent");
    expect(list[0].identity.emoji).toBe("robot");
  });

  it("includes messages.ackReaction when agent has identity", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      agentName: "PM Agent",
    });
    expect((config.messages as any).ackReaction).toBe("eyes");
  });

  it("includes brave search config when braveApiKey provided", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      braveApiKey: "BSA-test-key",
    });
    const tools = config.tools as any;
    expect(tools.web.search.provider).toBe("brave");
    expect(tools.web.search.apiKey).toBe("BSA-test-key");
  });

  it("omits tools section when no braveApiKey", () => {
    const config = generateFullOpenClawConfig(BASE_OPTIONS);
    expect(config.tools).toBeUndefined();
  });
});

describe("generateFullOpenClawConfig — plugins", () => {
  it("includes plugin entries for plugins.entries path", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      plugins: [{
        name: "openclaw-linear",
        enabled: true,
        config: { teamId: "TEAM-123" },
        secretEnvVars: { apiKey: "LINEAR_API_KEY" },
        configPath: "plugins.entries",
      }],
      resolvedSecrets: { LINEAR_API_KEY: "lin_api_test" },
    });
    const entries = (config.plugins as any).entries;
    expect(entries["openclaw-linear"]).toBeDefined();
    expect(entries["openclaw-linear"].enabled).toBe(true);
    expect(entries["openclaw-linear"].config.teamId).toBe("TEAM-123");
    expect(entries["openclaw-linear"].config.apiKey).toBe("lin_api_test");
  });

  it("includes channel config for channels path", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      plugins: [{
        name: "slack",
        enabled: true,
        config: { mode: "socket", teamId: "T123" },
        secretEnvVars: { botToken: "SLACK_BOT_TOKEN" },
        configPath: "channels",
      }],
      resolvedSecrets: { SLACK_BOT_TOKEN: "xoxb-test" },
    });
    const channels = config.channels as any;
    expect(channels["slack"]).toBeDefined();
    expect(channels["slack"].mode).toBe("socket");
    expect(channels["slack"].botToken).toBe("xoxb-test");
    expect(channels["slack"].enabled).toBe(true);
  });

  it("filters internalKeys from plugins.entries config", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      plugins: [{
        name: "openclaw-linear",
        enabled: true,
        config: {
          agentId: "pm",
          linearUserUuid: "uuid-1234",
          agentMapping: { "uuid-1234": "default" },
          stateActions: { started: "add" },
        },
        secretEnvVars: {
          apiKey: "LINEAR_API_KEY",
          linearUserUuid: "LINEAR_USER_UUID",
        },
        configPath: "plugins.entries",
        internalKeys: ["agentId", "linearUserUuid"],
      }],
      resolvedSecrets: { LINEAR_API_KEY: "lin_test", LINEAR_USER_UUID: "uuid-val" },
    });
    const pluginConfig = (config.plugins as any).entries["openclaw-linear"].config;
    expect(pluginConfig.apiKey).toBe("lin_test");
    expect(pluginConfig.agentMapping).toBeDefined();
    expect(pluginConfig.stateActions).toBeDefined();
    expect(pluginConfig.agentId).toBeUndefined();
    expect(pluginConfig.linearUserUuid).toBeUndefined();
  });

  it("filters internalKeys from channels config", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      plugins: [{
        name: "slack",
        enabled: true,
        config: {
          agentId: "eng",
          mode: "socket",
        },
        secretEnvVars: {
          botToken: "SLACK_BOT_TOKEN",
        },
        configPath: "channels",
        internalKeys: ["agentId"],
      }],
      resolvedSecrets: { SLACK_BOT_TOKEN: "xoxb-test" },
    });
    const slack = (config.channels as any)["slack"];
    expect(slack.mode).toBe("socket");
    expect(slack.botToken).toBe("xoxb-test");
    expect(slack.agentId).toBeUndefined();
  });

  it("passes all config through when internalKeys is empty", () => {
    const config = generateFullOpenClawConfig({
      ...BASE_OPTIONS,
      plugins: [{
        name: "test-plugin",
        enabled: true,
        config: { someKey: "someValue" },
        secretEnvVars: { token: "TEST_TOKEN" },
        configPath: "plugins.entries",
        internalKeys: [],
      }],
      resolvedSecrets: { TEST_TOKEN: "tok_test" },
    });
    const pluginConfig = (config.plugins as any).entries["test-plugin"].config;
    expect(pluginConfig.someKey).toBe("someValue");
    expect(pluginConfig.token).toBe("tok_test");
  });
});
