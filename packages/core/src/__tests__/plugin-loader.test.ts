import { describe, it, expect } from "vitest";
import {
  resolvePlugin,
  resolvePlugins,
  collectPluginSecrets,
  buildKnownSecrets,
  buildValidators,
  isSecretCoveredByPlugin,
  PLUGIN_MANIFEST_REGISTRY,
} from "../index";
import type { IdentityResult, PluginManifest } from "../index";

// ---------------------------------------------------------------------------
// resolvePlugin
// ---------------------------------------------------------------------------

describe("resolvePlugin", () => {
  it("resolves openclaw-linear from built-in registry", () => {
    const manifest = resolvePlugin("openclaw-linear");
    expect(manifest.name).toBe("openclaw-linear");
    expect(manifest.displayName).toBe("Linear");
    expect(manifest.configPath).toBe("plugins.entries");
    expect(manifest.installable).toBe(true);
    expect(manifest.needsFunnel).toBe(true);
  });

  it("resolves slack from built-in registry", () => {
    const manifest = resolvePlugin("slack");
    expect(manifest.name).toBe("slack");
    expect(manifest.displayName).toBe("Slack");
    expect(manifest.configPath).toBe("channels");
    expect(manifest.installable).toBe(false);
    expect(manifest.needsFunnel).toBe(false);
  });

  it("returns generic fallback for unknown plugins", () => {
    const manifest = resolvePlugin("unknown-plugin");
    expect(manifest.name).toBe("unknown-plugin");
    expect(manifest.displayName).toBe("unknown-plugin");
    expect(manifest.configPath).toBe("plugins.entries");
    expect(manifest.installable).toBe(true);
    expect(Object.keys(manifest.secrets)).toHaveLength(0);
  });

  it("prefers identity-bundled manifests over built-in registry", () => {
    const identityBundled: PluginManifest = {
      name: "openclaw-linear",
      displayName: "Custom Linear",
      installable: false,
      needsFunnel: false,
      configPath: "channels",
      secrets: {},
      internalKeys: [],
      configTransforms: [],
    };
    const identityResult: IdentityResult = {
      manifest: { name: "test", displayName: "Test", role: "test", volumeSize: 30, skills: [], emoji: "test", description: "Test identity", templateVars: [] },
      files: {},
      pluginManifests: { "openclaw-linear": identityBundled },
    };

    const manifest = resolvePlugin("openclaw-linear", identityResult);
    // Identity-bundled override should win over built-in
    expect(manifest.displayName).toBe("Custom Linear");
    expect(manifest.configPath).toBe("channels");
  });

  it("uses identity-bundled manifest for unknown plugins", () => {
    const identityBundled: PluginManifest = {
      name: "custom-plugin",
      displayName: "Custom Plugin",
      installable: true,
      needsFunnel: false,
      configPath: "plugins.entries",
      secrets: {
        customKey: {
          envVar: "CUSTOM_KEY",
          scope: "agent",
          isSecret: true,
          required: true,
          autoResolvable: false,
        },
      },
      internalKeys: [],
      configTransforms: [],
    };
    const identityResult: IdentityResult = {
      manifest: { name: "test", displayName: "Test", role: "test", volumeSize: 30, skills: [], emoji: "test", description: "Test identity", templateVars: [] },
      files: {},
      pluginManifests: { "custom-plugin": identityBundled },
    };

    const manifest = resolvePlugin("custom-plugin", identityResult);
    expect(manifest.displayName).toBe("Custom Plugin");
    expect(Object.keys(manifest.secrets)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolvePlugins
// ---------------------------------------------------------------------------

describe("resolvePlugins", () => {
  it("batch-resolves multiple plugins", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack", "unknown"]);
    expect(manifests).toHaveLength(3);
    expect(manifests[0].name).toBe("openclaw-linear");
    expect(manifests[1].name).toBe("slack");
    expect(manifests[2].name).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// collectPluginSecrets
// ---------------------------------------------------------------------------

describe("collectPluginSecrets", () => {
  it("collects all secrets from Linear plugin", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const secrets = collectPluginSecrets([linearManifest]);

    expect(secrets).toHaveLength(3);
    const keys = secrets.map((s) => s.configKey);
    expect(keys).toContain("apiKey");
    expect(keys).toContain("webhookSecret");
    expect(keys).toContain("linearUserUuid");

    // All should reference the right plugin
    for (const s of secrets) {
      expect(s.pluginName).toBe("openclaw-linear");
    }
  });

  it("collects all secrets from Slack plugin", () => {
    const slackManifest = PLUGIN_MANIFEST_REGISTRY["slack"];
    const secrets = collectPluginSecrets([slackManifest]);

    expect(secrets).toHaveLength(2);
    const keys = secrets.map((s) => s.configKey);
    expect(keys).toContain("botToken");
    expect(keys).toContain("appToken");

    for (const s of secrets) {
      expect(s.pluginName).toBe("slack");
    }
  });

  it("collects secrets from multiple plugins without collisions", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack"]);
    const secrets = collectPluginSecrets(manifests);

    // 3 from linear + 2 from slack = 5
    expect(secrets).toHaveLength(5);

    // Each secret has correct plugin attribution
    const linearSecrets = secrets.filter((s) => s.pluginName === "openclaw-linear");
    const slackSecrets = secrets.filter((s) => s.pluginName === "slack");
    expect(linearSecrets).toHaveLength(3);
    expect(slackSecrets).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildKnownSecrets — namespaced by envVar-derived keys
// ---------------------------------------------------------------------------

describe("buildKnownSecrets", () => {
  it("produces properly namespaced keys for Linear", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const known = buildKnownSecrets([linearManifest]);

    // Keys should be envVar-derived camelCase, not raw config keys
    expect(known.linearApiKey).toBeDefined();
    expect(known.linearWebhookSecret).toBeDefined();
    expect(known.linearUserUuid).toBeDefined();

    // Raw keys should NOT be present
    expect(known.apiKey).toBeUndefined();
    expect(known.webhookSecret).toBeUndefined();

    expect(known.linearApiKey.isSecret).toBe(true);
    expect(known.linearApiKey.perAgent).toBe(true);
    expect(known.linearUserUuid.isSecret).toBe(false);
  });

  it("produces properly namespaced keys for Slack", () => {
    const slackManifest = PLUGIN_MANIFEST_REGISTRY["slack"];
    const known = buildKnownSecrets([slackManifest]);

    expect(known.slackBotToken).toBeDefined();
    expect(known.slackAppToken).toBeDefined();

    // Raw keys should NOT be present
    expect(known.botToken).toBeUndefined();
    expect(known.appToken).toBeUndefined();

    expect(known.slackBotToken.isSecret).toBe(true);
    expect(known.slackBotToken.perAgent).toBe(true);
  });

  it("does not collide when building from multiple plugins", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack"]);
    const known = buildKnownSecrets(manifests);

    // All 5 keys should be unique
    expect(Object.keys(known)).toHaveLength(5);
    expect(known.linearApiKey).toBeDefined();
    expect(known.slackBotToken).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildValidators — namespaced by envVar-derived keys
// ---------------------------------------------------------------------------

describe("buildValidators", () => {
  it("builds namespaced validator for Linear apiKey", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const validators = buildValidators([linearManifest]);

    expect(validators.linearApiKey).toBeDefined();
    expect(validators.linearApiKey("lin_api_test")).toBeUndefined(); // valid
    expect(validators.linearApiKey("bad")).toBe("Must start with lin_api_");

    // No validator for raw key
    expect(validators.apiKey).toBeUndefined();
  });

  it("builds namespaced validators for Slack tokens", () => {
    const slackManifest = PLUGIN_MANIFEST_REGISTRY["slack"];
    const validators = buildValidators([slackManifest]);

    expect(validators.slackBotToken).toBeDefined();
    expect(validators.slackBotToken("xoxb-test")).toBeUndefined();
    expect(validators.slackBotToken("bad")).toBe("Must start with xoxb-");

    expect(validators.slackAppToken).toBeDefined();
    expect(validators.slackAppToken("xapp-test")).toBeUndefined();
    expect(validators.slackAppToken("bad")).toBe("Must start with xapp-");
  });

  it("does not create validators for secrets without validator field", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const validators = buildValidators([linearManifest]);

    // linearWebhookSecret and linearUserUuid have no validator field
    expect(validators.linearWebhookSecret).toBeUndefined();
    expect(validators.linearUserUuid).toBeUndefined();
  });

  it("does not collide when building from multiple plugins", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack"]);
    const validators = buildValidators(manifests);

    // Linear has 1 validator (apiKey), Slack has 2 (botToken, appToken) = 3 total
    expect(Object.keys(validators)).toHaveLength(3);
    expect(validators.linearApiKey).toBeDefined();
    expect(validators.slackBotToken).toBeDefined();
    expect(validators.slackAppToken).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// isSecretCoveredByPlugin
// ---------------------------------------------------------------------------

describe("isSecretCoveredByPlugin", () => {
  it("returns true for secrets defined in a plugin", () => {
    const manifests = resolvePlugins(["openclaw-linear"]);
    expect(isSecretCoveredByPlugin("apiKey", manifests)).toBe(true);
    expect(isSecretCoveredByPlugin("webhookSecret", manifests)).toBe(true);
    expect(isSecretCoveredByPlugin("linearUserUuid", manifests)).toBe(true);
  });

  it("returns false for secrets not defined in any plugin", () => {
    const manifests = resolvePlugins(["openclaw-linear", "slack"]);
    expect(isSecretCoveredByPlugin("notionApiKey", manifests)).toBe(false);
    expect(isSecretCoveredByPlugin("githubToken", manifests)).toBe(false);
  });

  it("returns true for Slack secrets", () => {
    const manifests = resolvePlugins(["slack"]);
    expect(isSecretCoveredByPlugin("botToken", manifests)).toBe(true);
    expect(isSecretCoveredByPlugin("appToken", manifests)).toBe(true);
  });
});
