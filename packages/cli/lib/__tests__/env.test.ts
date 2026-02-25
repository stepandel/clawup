import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import {
  parseEnvFile,
  resolveEnvRef,
  extractEnvVarName,
  loadEnvSecrets,
  buildEnvDict,
  buildManifestSecrets,
  generateEnvExample,
  agentEnvVarName,
  camelToScreamingSnake,
  VALIDATORS,
  WELL_KNOWN_ENV_VARS,
} from "../env";

vi.mock("fs");
const mockedFs = vi.mocked(fs);

describe("parseEnvFile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns empty object for non-existent file", () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(parseEnvFile("/path/to/.env")).toEqual({});
  });

  it("parses KEY=value lines", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      "FOO=bar\nBAZ=qux\n"
    );
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("skips comments and empty lines", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      "# this is a comment\n\nFOO=bar\n  # another comment\n"
    );
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "bar" });
  });

  it("handles double-quoted values", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('FOO="hello world"\n');
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "hello world" });
  });

  it("handles single-quoted values", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("FOO='hello world'\n");
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "hello world" });
  });

  it("handles values with equals signs", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("FOO=bar=baz\n");
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "bar=baz" });
  });

  it("handles whitespace around key and value", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("  FOO  =  bar  \n");
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "bar" });
  });

  it("handles empty value", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("FOO=\n");
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "" });
  });

  it("skips lines without equals sign", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("NOEQUALSSIGN\nFOO=bar\n");
    expect(parseEnvFile("/path/to/.env")).toEqual({ FOO: "bar" });
  });
});

describe("resolveEnvRef", () => {
  it("resolves ${env:VAR} references", () => {
    const env = { MY_KEY: "secret123" };
    expect(resolveEnvRef("${env:MY_KEY}", env)).toBe("secret123");
  });

  it("returns undefined for unresolved ${env:VAR} references", () => {
    const env = {};
    expect(resolveEnvRef("${env:MISSING_KEY}", env)).toBeUndefined();
  });

  it("returns plain strings as-is (backwards compat)", () => {
    expect(resolveEnvRef("plain-value", {})).toBe("plain-value");
  });

  it("returns empty string as-is", () => {
    expect(resolveEnvRef("", {})).toBe("");
  });

  it("does not match partial env refs", () => {
    expect(resolveEnvRef("prefix${env:VAR}suffix", {})).toBe("prefix${env:VAR}suffix");
  });
});

describe("extractEnvVarName", () => {
  it("extracts var name from ${env:VAR}", () => {
    expect(extractEnvVarName("${env:ANTHROPIC_API_KEY}")).toBe("ANTHROPIC_API_KEY");
  });

  it("returns undefined for plain strings", () => {
    expect(extractEnvVarName("plain-value")).toBeUndefined();
  });
});

describe("loadEnvSecrets", () => {
  it("resolves global secrets from env dict", () => {
    const manifestSecrets = {
      anthropicApiKey: "${env:ANTHROPIC_API_KEY}",
      tailscaleAuthKey: "${env:TAILSCALE_AUTH_KEY}",
    };
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-test",
      TAILSCALE_AUTH_KEY: "tskey-auth-test",
    };
    const result = loadEnvSecrets(manifestSecrets, [], env);

    expect(result.global).toEqual({
      anthropicApiKey: "sk-ant-test",
      tailscaleAuthKey: "tskey-auth-test",
    });
    expect(result.missing).toEqual([]);
  });

  it("tracks missing secrets", () => {
    const manifestSecrets = {
      anthropicApiKey: "${env:ANTHROPIC_API_KEY}",
      tailscaleAuthKey: "${env:TAILSCALE_AUTH_KEY}",
    };
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };
    const result = loadEnvSecrets(manifestSecrets, [], env);

    expect(result.global.anthropicApiKey).toBe("sk-ant-test");
    expect(result.missing).toEqual([
      { key: "tailscaleAuthKey", envVar: "TAILSCALE_AUTH_KEY" },
    ]);
  });

  it("resolves per-agent secrets", () => {
    const agents: Array<{ name: string; secrets?: Record<string, string> }> = [
      { name: "agent-pm", secrets: { slackBotToken: "${env:PM_SLACK_BOT_TOKEN}" } },
      { name: "agent-eng", secrets: { githubToken: "${env:ENG_GITHUB_TOKEN}" } },
    ];
    const env = {
      PM_SLACK_BOT_TOKEN: "xoxb-test",
      ENG_GITHUB_TOKEN: "ghp_test",
    };
    const result = loadEnvSecrets(undefined, agents, env);

    expect(result.perAgent["agent-pm"]).toEqual({ slackBotToken: "xoxb-test" });
    expect(result.perAgent["agent-eng"]).toEqual({ githubToken: "ghp_test" });
    expect(result.missing).toEqual([]);
  });

  it("tracks missing per-agent secrets", () => {
    const agents = [
      { name: "agent-pm", secrets: { slackBotToken: "${env:PM_SLACK_BOT_TOKEN}" } },
    ];
    const result = loadEnvSecrets(undefined, agents, {});

    expect(result.missing).toEqual([
      { key: "slackBotToken", envVar: "PM_SLACK_BOT_TOKEN", agent: "agent-pm" },
    ]);
  });

  it("handles plain string values (backwards compat)", () => {
    const manifestSecrets = { anthropicApiKey: "sk-ant-hardcoded" };
    const result = loadEnvSecrets(manifestSecrets, [], {});

    expect(result.global.anthropicApiKey).toBe("sk-ant-hardcoded");
    expect(result.missing).toEqual([]);
  });

  it("handles undefined manifest secrets", () => {
    const result = loadEnvSecrets(undefined, [], {});
    expect(result.global).toEqual({});
    expect(result.missing).toEqual([]);
  });

  it("handles agents without secrets", () => {
    const agents = [{ name: "agent-pm" }];
    const result = loadEnvSecrets(undefined, agents, {});
    expect(result.perAgent).toEqual({});
  });
});

describe("buildEnvDict", () => {
  afterEach(() => vi.restoreAllMocks());

  it("merges .env file with process.env (process.env takes precedence)", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("FOO=from-file\nBAR=also-file\n");

    const originalEnv = process.env;
    process.env = { ...originalEnv, FOO: "from-process" };

    try {
      const result = buildEnvDict("/path/to/.env");
      expect(result.FOO).toBe("from-process");
      expect(result.BAR).toBe("also-file");
    } finally {
      process.env = originalEnv;
    }
  });
});

describe("VALIDATORS", () => {
  it("validates anthropicApiKey prefix", () => {
    expect(VALIDATORS.anthropicApiKey("sk-ant-test")).toBeUndefined();
    expect(VALIDATORS.anthropicApiKey("bad-key")).toBe("Must start with sk-ant-");
  });

  it("validates tailscaleAuthKey prefix", () => {
    expect(VALIDATORS.tailscaleAuthKey("tskey-auth-test")).toBeUndefined();
    expect(VALIDATORS.tailscaleAuthKey("bad")).toBe("Must start with tskey-auth-");
  });

  it("validates tailnetDnsName suffix", () => {
    expect(VALIDATORS.tailnetDnsName("my.ts.net")).toBeUndefined();
    expect(VALIDATORS.tailnetDnsName("bad")).toBe("Must end with .ts.net");
  });

  it("validates slackBotToken prefix", () => {
    expect(VALIDATORS.slackBotToken("xoxb-test")).toBeUndefined();
    expect(VALIDATORS.slackBotToken("bad")).toBe("Must start with xoxb-");
  });

  it("validates slackAppToken prefix", () => {
    expect(VALIDATORS.slackAppToken("xapp-test")).toBeUndefined();
    expect(VALIDATORS.slackAppToken("bad")).toBe("Must start with xapp-");
  });

  it("validates linearApiKey prefix", () => {
    expect(VALIDATORS.linearApiKey("lin_api_test")).toBeUndefined();
    expect(VALIDATORS.linearApiKey("bad")).toBe("Must start with lin_api_");
  });

  it("validates githubToken prefix", () => {
    expect(VALIDATORS.githubToken("ghp_test")).toBeUndefined();
    expect(VALIDATORS.githubToken("github_pat_test")).toBeUndefined();
    expect(VALIDATORS.githubToken("bad")).toBe("Must start with ghp_ or github_pat_");
  });
});

describe("agentEnvVarName", () => {
  it("generates <ROLE>_<SUFFIX> env var names", () => {
    expect(agentEnvVarName("pm", "SLACK_BOT_TOKEN")).toBe("PM_SLACK_BOT_TOKEN");
    expect(agentEnvVarName("eng", "GITHUB_TOKEN")).toBe("ENG_GITHUB_TOKEN");
  });
});

describe("WELL_KNOWN_ENV_VARS", () => {
  it("maps secret keys to env var names", () => {
    expect(WELL_KNOWN_ENV_VARS.anthropicApiKey).toBe("ANTHROPIC_API_KEY");
    expect(WELL_KNOWN_ENV_VARS.tailscaleAuthKey).toBe("TAILSCALE_AUTH_KEY");
    expect(WELL_KNOWN_ENV_VARS.tailnetDnsName).toBe("TAILNET_DNS_NAME");
    expect(WELL_KNOWN_ENV_VARS.hcloudToken).toBe("HCLOUD_TOKEN");
  });
});

describe("buildManifestSecrets", () => {
  it("includes required global secrets", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [{ name: "agent-pm", role: "pm", displayName: "Juno" }],
      allPluginNames: new Set(),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set()]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    expect(result.global.anthropicApiKey).toBe("${env:ANTHROPIC_API_KEY}");
    expect(result.global.tailscaleAuthKey).toBe("${env:TAILSCALE_AUTH_KEY}");
    expect(result.global.tailnetDnsName).toBe("${env:TAILNET_DNS_NAME}");
    expect(result.global.tailscaleApiKey).toBe("${env:TAILSCALE_API_KEY}");
    expect(result.global.hcloudToken).toBeUndefined();
  });

  it("includes hcloudToken for Hetzner provider", () => {
    const result = buildManifestSecrets({
      provider: "hetzner",
      agents: [],
      allPluginNames: new Set(),
      allDepNames: new Set(),
      agentPlugins: new Map(),
      agentDeps: new Map(),
    });

    expect(result.global.hcloudToken).toBe("${env:HCLOUD_TOKEN}");
  });

  it("includes braveApiKey when brave-search dep present", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [],
      allPluginNames: new Set(),
      allDepNames: new Set(["brave-search"]),
      agentPlugins: new Map(),
      agentDeps: new Map(),
    });

    expect(result.global.braveApiKey).toBe("${env:BRAVE_API_KEY}");
  });

  it("builds per-agent secrets for slack plugin", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [{ name: "agent-pm", role: "pm", displayName: "Juno" }],
      allPluginNames: new Set(["slack"]),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set(["slack"])]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    expect(result.perAgent["agent-pm"]).toEqual({
      slackBotToken: "${env:PM_SLACK_BOT_TOKEN}",
      slackAppToken: "${env:PM_SLACK_APP_TOKEN}",
    });
  });

  it("builds per-agent secrets for linear plugin", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [{ name: "agent-eng", role: "eng", displayName: "Titus" }],
      allPluginNames: new Set(["openclaw-linear"]),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-eng", new Set(["openclaw-linear"])]]),
      agentDeps: new Map([["agent-eng", new Set()]]),
    });

    expect(result.perAgent["agent-eng"]).toEqual({
      linearApiKey: "${env:ENG_LINEAR_API_KEY}",
      linearWebhookSecret: "${env:ENG_LINEAR_WEBHOOK_SECRET}",
    });
  });

  it("builds per-agent secrets for gh dep", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [{ name: "agent-eng", role: "eng", displayName: "Titus" }],
      allPluginNames: new Set(),
      allDepNames: new Set(["gh"]),
      agentPlugins: new Map([["agent-eng", new Set()]]),
      agentDeps: new Map([["agent-eng", new Set(["gh"])]]),
    });

    expect(result.perAgent["agent-eng"]).toEqual({
      githubToken: "${env:ENG_GITHUB_TOKEN}",
    });
  });
});

describe("camelToScreamingSnake", () => {
  it("converts simple camelCase", () => {
    expect(camelToScreamingSnake("notionApiKey")).toBe("NOTION_API_KEY");
  });

  it("converts camelCase with consecutive capitals", () => {
    expect(camelToScreamingSnake("slackBotToken")).toBe("SLACK_BOT_TOKEN");
  });

  it("handles single word", () => {
    expect(camelToScreamingSnake("token")).toBe("TOKEN");
  });

  it("converts customWebhookSecret", () => {
    expect(camelToScreamingSnake("customWebhookSecret")).toBe("CUSTOM_WEBHOOK_SECRET");
  });

  it("handles already uppercase", () => {
    expect(camelToScreamingSnake("API")).toBe("API");
  });
});

describe("buildManifestSecrets with requiredSecrets", () => {
  it("adds requiredSecrets as per-agent env refs", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [
        { name: "agent-pm", role: "pm", displayName: "Juno", requiredSecrets: ["notionApiKey"] },
      ],
      allPluginNames: new Set(),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set()]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    expect(result.perAgent["agent-pm"]).toEqual({
      notionApiKey: "${env:PM_NOTION_API_KEY}",
    });
  });

  it("does not duplicate plugin-derived secrets listed in requiredSecrets", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [
        { name: "agent-pm", role: "pm", displayName: "Juno", requiredSecrets: ["slackBotToken", "notionApiKey"] },
      ],
      allPluginNames: new Set(["slack"]),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set(["slack"])]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    // slackBotToken/slackAppToken from plugin, notionApiKey from requiredSecrets
    expect(result.perAgent["agent-pm"]).toEqual({
      slackBotToken: "${env:PM_SLACK_BOT_TOKEN}",
      slackAppToken: "${env:PM_SLACK_APP_TOKEN}",
      notionApiKey: "${env:PM_NOTION_API_KEY}",
    });
  });

  it("adds multiple requiredSecrets for multiple agents", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [
        { name: "agent-pm", role: "pm", displayName: "Juno", requiredSecrets: ["notionApiKey"] },
        { name: "agent-eng", role: "eng", displayName: "Titus", requiredSecrets: ["customWebhookSecret"] },
      ],
      allPluginNames: new Set(),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set()], ["agent-eng", new Set()]]),
      agentDeps: new Map([["agent-pm", new Set()], ["agent-eng", new Set()]]),
    });

    expect(result.perAgent["agent-pm"]).toEqual({
      notionApiKey: "${env:PM_NOTION_API_KEY}",
    });
    expect(result.perAgent["agent-eng"]).toEqual({
      customWebhookSecret: "${env:ENG_CUSTOM_WEBHOOK_SECRET}",
    });
  });

  it("handles agents without requiredSecrets (undefined)", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [
        { name: "agent-pm", role: "pm", displayName: "Juno" },
      ],
      allPluginNames: new Set(),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set()]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    expect(result.perAgent["agent-pm"]).toBeUndefined();
  });

  it("handles empty requiredSecrets array", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [
        { name: "agent-pm", role: "pm", displayName: "Juno", requiredSecrets: [] },
      ],
      allPluginNames: new Set(),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set()]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    expect(result.perAgent["agent-pm"]).toBeUndefined();
  });
});

describe("generateEnvExample", () => {
  it("generates .env.example with global and per-agent sections", () => {
    const result = generateEnvExample({
      globalSecrets: {
        anthropicApiKey: "${env:ANTHROPIC_API_KEY}",
        tailscaleAuthKey: "${env:TAILSCALE_AUTH_KEY}",
      },
      agents: [
        { name: "agent-pm", displayName: "Juno", role: "pm" },
      ],
      perAgentSecrets: {
        "agent-pm": {
          slackBotToken: "${env:PM_SLACK_BOT_TOKEN}",
        },
      },
    });

    expect(result).toContain("ANTHROPIC_API_KEY=");
    expect(result).toContain("TAILSCALE_AUTH_KEY=");
    expect(result).toContain("# ── Agent: Juno (pm)");
    expect(result).toContain("PM_SLACK_BOT_TOKEN=");
  });

  it("skips agents with no secrets", () => {
    const result = generateEnvExample({
      globalSecrets: { anthropicApiKey: "${env:ANTHROPIC_API_KEY}" },
      agents: [
        { name: "agent-pm", displayName: "Juno", role: "pm" },
      ],
      perAgentSecrets: {},
    });

    expect(result).toContain("ANTHROPIC_API_KEY=");
    expect(result).not.toContain("Agent: Juno");
  });
});
