/**
 * End-to-end plugin integration tests for Slack and Linear plugins.
 *
 * Verifies the full plugin manifest system works from resolution through
 * secrets, config generation, and webhook setup.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import {
  resolvePlugin,
  resolvePlugins,
  collectPluginSecrets,
  buildKnownSecrets,
  buildValidators,
  PLUGIN_MANIFEST_REGISTRY,
  getSecretEnvVars,
} from "@clawup/core";
import { buildManifestSecrets, generateEnvExample } from "../env";

vi.mock("fs");
const mockedFs = vi.mocked(fs);

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// E2E: Plugin resolution → Secret collection → Config generation
// ---------------------------------------------------------------------------

describe("E2E: Linear plugin", () => {
  const linearManifest = resolvePlugin("openclaw-linear");

  it("resolution provides complete manifest metadata", () => {
    expect(linearManifest.name).toBe("openclaw-linear");
    expect(linearManifest.displayName).toBe("Linear");
    expect(linearManifest.configPath).toBe("plugins.entries");
    expect(linearManifest.installable).toBe(true);
    expect(linearManifest.needsFunnel).toBe(true);
    expect(linearManifest.internalKeys).toContain("agentId");
    expect(linearManifest.internalKeys).toContain("linearUserUuid");
  });

  it("secret collection returns correct prefixed keys in buildManifestSecrets", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [{ name: "agent-eng", role: "eng", displayName: "Titus" }],
      allPluginNames: new Set(["openclaw-linear"]),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-eng", new Set(["openclaw-linear"])]]),
      agentDeps: new Map([["agent-eng", new Set()]]),
    });

    // Secrets use envVar-derived camelCase keys
    expect(result.perAgent["agent-eng"].linearApiKey).toBe("${env:ENG_LINEAR_API_KEY}");
    expect(result.perAgent["agent-eng"].linearWebhookSecret).toBe("${env:ENG_LINEAR_WEBHOOK_SECRET}");
    expect(result.perAgent["agent-eng"].linearUserUuid).toBe("${env:ENG_LINEAR_USER_UUID}");
  });

  it("buildKnownSecrets produces properly namespaced entries", () => {
    const known = buildKnownSecrets([linearManifest]);

    expect(known.linearApiKey).toEqual({
      label: "Linear Api Key",
      perAgent: true,
      isSecret: true,
    });
    expect(known.linearUserUuid).toEqual({
      label: "Linear Linear User Uuid",
      perAgent: true,
      isSecret: false,
    });

    // Raw keys should NOT be present
    expect(known.apiKey).toBeUndefined();
  });

  it("buildValidators creates namespaced validators", () => {
    const validators = buildValidators([linearManifest]);

    expect(validators.linearApiKey).toBeDefined();
    expect(validators.linearApiKey("lin_api_test123")).toBeUndefined(); // valid
    expect(validators.linearApiKey("invalid")).toBe("Must start with lin_api_");

    // webhookSecret has no validator
    expect(validators.linearWebhookSecret).toBeUndefined();
  });

  it("config generation routes to plugins.entries path", () => {
    expect(linearManifest.configPath).toBe("plugins.entries");
  });

  it("webhook setup is consistent", () => {
    expect(linearManifest.webhookSetup).toBeDefined();
    const setup = linearManifest.webhookSetup!;

    expect(setup.urlPath).toBe("/hooks/linear");
    expect(setup.secretKey).toBe("webhookSecret");
    // secretKey must reference a real secret
    expect(linearManifest.secrets[setup.secretKey]).toBeDefined();
    // configJsonPath must use the plugin's actual name
    expect(setup.configJsonPath).toBe("plugins.entries.openclaw-linear.config.webhookSecret");
    expect(setup.configJsonPath).toContain(linearManifest.name);
  });

  it("getSecretEnvVars produces correct mapping", () => {
    const envVars = getSecretEnvVars(linearManifest);
    expect(envVars).toEqual({
      apiKey: "LINEAR_API_KEY",
      webhookSecret: "LINEAR_WEBHOOK_SECRET",
      linearUserUuid: "LINEAR_USER_UUID",
    });
  });
});

describe("E2E: Slack plugin", () => {
  const slackManifest = resolvePlugin("slack");

  it("resolution provides complete manifest metadata", () => {
    expect(slackManifest.name).toBe("slack");
    expect(slackManifest.displayName).toBe("Slack");
    expect(slackManifest.configPath).toBe("channels");
    expect(slackManifest.installable).toBe(false);
    expect(slackManifest.needsFunnel).toBe(false);
    expect(slackManifest.internalKeys).toEqual([]);
  });

  it("secret collection returns correct prefixed keys in buildManifestSecrets", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [{ name: "agent-pm", role: "pm", displayName: "Juno" }],
      allPluginNames: new Set(["slack"]),
      allDepNames: new Set(),
      agentPlugins: new Map([["agent-pm", new Set(["slack"])]]),
      agentDeps: new Map([["agent-pm", new Set()]]),
    });

    expect(result.perAgent["agent-pm"].slackBotToken).toBe("${env:PM_SLACK_BOT_TOKEN}");
    expect(result.perAgent["agent-pm"].slackAppToken).toBe("${env:PM_SLACK_APP_TOKEN}");
  });

  it("buildKnownSecrets produces properly namespaced entries", () => {
    const known = buildKnownSecrets([slackManifest]);

    expect(known.slackBotToken).toEqual({
      label: "Slack Bot Token",
      perAgent: true,
      isSecret: true,
    });
    expect(known.slackAppToken).toEqual({
      label: "Slack App Token",
      perAgent: true,
      isSecret: true,
    });

    // Raw keys should NOT be present
    expect(known.botToken).toBeUndefined();
  });

  it("buildValidators creates namespaced validators", () => {
    const validators = buildValidators([slackManifest]);

    expect(validators.slackBotToken).toBeDefined();
    expect(validators.slackBotToken("xoxb-test")).toBeUndefined(); // valid
    expect(validators.slackBotToken("bad")).toBe("Must start with xoxb-");

    expect(validators.slackAppToken).toBeDefined();
    expect(validators.slackAppToken("xapp-test")).toBeUndefined(); // valid
    expect(validators.slackAppToken("bad")).toBe("Must start with xapp-");
  });

  it("config generation routes to channels path", () => {
    expect(slackManifest.configPath).toBe("channels");
  });

  it("no webhook setup for Slack", () => {
    expect(slackManifest.webhookSetup).toBeUndefined();
  });

  it("config transforms define dm flattening", () => {
    expect(slackManifest.configTransforms).toHaveLength(1);
    const transform = slackManifest.configTransforms[0];
    expect(transform.sourceKey).toBe("dm");
    expect(transform.targetKeys).toEqual({
      policy: "dmPolicy",
      allowFrom: "allowFrom",
    });
    expect(transform.removeSource).toBe(true);
  });

  it("getSecretEnvVars produces correct mapping", () => {
    const envVars = getSecretEnvVars(slackManifest);
    expect(envVars).toEqual({
      botToken: "SLACK_BOT_TOKEN",
      appToken: "SLACK_APP_TOKEN",
    });
  });
});

// ---------------------------------------------------------------------------
// E2E: Multi-plugin scenarios
// ---------------------------------------------------------------------------

describe("E2E: Multi-plugin integration", () => {
  it("combined secrets from Linear + Slack don't collide", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack"]);
    const allSecrets = collectPluginSecrets(manifests);

    // 3 from linear + 2 from slack = 5
    expect(allSecrets).toHaveLength(5);

    // Build known secrets map - all keys unique
    const known = buildKnownSecrets(manifests);
    expect(Object.keys(known)).toHaveLength(5);

    // Verify each key is properly namespaced
    expect(known.linearApiKey).toBeDefined();
    expect(known.linearWebhookSecret).toBeDefined();
    expect(known.linearUserUuid).toBeDefined();
    expect(known.slackBotToken).toBeDefined();
    expect(known.slackAppToken).toBeDefined();
  });

  it("combined validators from Linear + Slack are all accessible", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack"]);
    const validators = buildValidators(manifests);

    // 1 from linear (apiKey) + 2 from slack (botToken, appToken) = 3
    expect(Object.keys(validators)).toHaveLength(3);

    expect(validators.linearApiKey("lin_api_test")).toBeUndefined();
    expect(validators.slackBotToken("xoxb-test")).toBeUndefined();
    expect(validators.slackAppToken("xapp-test")).toBeUndefined();
  });

  it("buildManifestSecrets produces correct per-agent secrets for multi-plugin agent", () => {
    const result = buildManifestSecrets({
      provider: "aws",
      agents: [
        { name: "agent-pm", role: "pm", displayName: "Juno" },
      ],
      allPluginNames: new Set(["openclaw-linear", "slack"]),
      allDepNames: new Set(["gh"]),
      agentPlugins: new Map([["agent-pm", new Set(["openclaw-linear", "slack"])]]),
      agentDeps: new Map([["agent-pm", new Set(["gh"])]]),
    });

    const pmSecrets = result.perAgent["agent-pm"];
    expect(pmSecrets).toBeDefined();

    // Linear secrets
    expect(pmSecrets.linearApiKey).toBe("${env:PM_LINEAR_API_KEY}");
    expect(pmSecrets.linearWebhookSecret).toBe("${env:PM_LINEAR_WEBHOOK_SECRET}");
    expect(pmSecrets.linearUserUuid).toBe("${env:PM_LINEAR_USER_UUID}");

    // Slack secrets
    expect(pmSecrets.slackBotToken).toBe("${env:PM_SLACK_BOT_TOKEN}");
    expect(pmSecrets.slackAppToken).toBe("${env:PM_SLACK_APP_TOKEN}");

    // Dep secrets
    expect(pmSecrets.githubToken).toBe("${env:PM_GITHUB_TOKEN}");
  });

  it("generateEnvExample marks auto-resolvable secrets as commented", () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = generateEnvExample({
      globalSecrets: { anthropicApiKey: "${env:ANTHROPIC_API_KEY}" },
      agents: [{ name: "agent-eng", displayName: "Titus", role: "eng" }],
      perAgentSecrets: {
        "agent-eng": {
          linearApiKey: "${env:ENG_LINEAR_API_KEY}",
          linearUserUuid: "${env:ENG_LINEAR_USER_UUID}",
          slackBotToken: "${env:ENG_SLACK_BOT_TOKEN}",
        },
      },
    });

    // linearApiKey should be required (uncommented)
    expect(result).toContain("ENG_LINEAR_API_KEY=");
    // linearUserUuid should be auto-resolved (commented)
    expect(result).toMatch(/# ENG_LINEAR_USER_UUID=/);
    // slackBotToken should be required (uncommented)
    expect(result).toContain("ENG_SLACK_BOT_TOKEN=");
  });
});

// ---------------------------------------------------------------------------
// E2E: Webhook URL and secret consistency
// ---------------------------------------------------------------------------

describe("E2E: Webhook consistency", () => {
  it("Linear webhook secretKey references a real secret with envVar", () => {
    const linear = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const setup = linear.webhookSetup!;
    const secret = linear.secrets[setup.secretKey];

    expect(secret).toBeDefined();
    expect(secret.envVar).toBe("LINEAR_WEBHOOK_SECRET");
    expect(secret.isSecret).toBe(true);
    expect(secret.scope).toBe("agent");
  });

  it("Linear configJsonPath matches plugin name", () => {
    const linear = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const setup = linear.webhookSetup!;

    // Should use openclaw-linear, not just "linear"
    expect(setup.configJsonPath).toBe("plugins.entries.openclaw-linear.config.webhookSecret");
  });

  it("Slack has no webhook setup (uses Socket Mode)", () => {
    const slack = PLUGIN_MANIFEST_REGISTRY["slack"];
    expect(slack.webhookSetup).toBeUndefined();
  });
});
