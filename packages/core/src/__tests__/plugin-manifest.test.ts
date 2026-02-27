import { describe, it, expect } from "vitest";
import {
  PluginManifestSchema,
  PluginSecretSchema,
  WebhookSetupSchema,
  ConfigTransformSchema,
  PLUGIN_MANIFEST_REGISTRY,
} from "../index";

// ---------------------------------------------------------------------------
// PluginSecretSchema
// ---------------------------------------------------------------------------

describe("PluginSecretSchema", () => {
  it("accepts a valid secret definition", () => {
    const result = PluginSecretSchema.safeParse({
      envVar: "LINEAR_API_KEY",
      scope: "agent",
      isSecret: true,
      required: true,
      autoResolvable: false,
      validator: "lin_api_",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = PluginSecretSchema.safeParse({
      envVar: "MY_SECRET",
      scope: "global",
      isSecret: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required).toBe(true); // default
      expect(result.data.autoResolvable).toBe(false); // default
      expect(result.data.validator).toBeUndefined();
    }
  });

  it("rejects invalid scope", () => {
    const result = PluginSecretSchema.safeParse({
      envVar: "MY_SECRET",
      scope: "invalid",
      isSecret: true,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WebhookSetupSchema
// ---------------------------------------------------------------------------

describe("WebhookSetupSchema", () => {
  it("accepts a valid webhook setup", () => {
    const result = WebhookSetupSchema.safeParse({
      urlPath: "/hooks/linear",
      secretKey: "webhookSecret",
      instructions: ["Step 1", "Step 2"],
      configJsonPath: "plugins.entries.openclaw-linear.config.webhookSecret",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = WebhookSetupSchema.safeParse({
      urlPath: "/hooks/linear",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConfigTransformSchema
// ---------------------------------------------------------------------------

describe("ConfigTransformSchema", () => {
  it("accepts a valid config transform", () => {
    const result = ConfigTransformSchema.safeParse({
      sourceKey: "dm",
      targetKeys: { policy: "dmPolicy", allowFrom: "allowFrom" },
      removeSource: true,
    });
    expect(result.success).toBe(true);
  });

  it("defaults removeSource to true", () => {
    const result = ConfigTransformSchema.safeParse({
      sourceKey: "dm",
      targetKeys: { policy: "dmPolicy" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.removeSource).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PluginManifestSchema
// ---------------------------------------------------------------------------

describe("PluginManifestSchema", () => {
  it("accepts the built-in Linear manifest", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    const result = PluginManifestSchema.safeParse(linearManifest);
    expect(result.success).toBe(true);
  });

  it("accepts the built-in Slack manifest", () => {
    const slackManifest = PLUGIN_MANIFEST_REGISTRY["slack"];
    const result = PluginManifestSchema.safeParse(slackManifest);
    expect(result.success).toBe(true);
  });

  it("accepts a minimal plugin manifest", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-plugin",
      displayName: "Test Plugin",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.needsFunnel).toBe(false); // default
      expect(result.data.internalKeys).toEqual([]); // default
      expect(result.data.configTransforms).toEqual([]); // default
      expect(result.data.webhookSetup).toBeUndefined();
    }
  });

  it("rejects invalid configPath", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test",
      displayName: "Test",
      installable: true,
      configPath: "invalid",
      secrets: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts manifest with webhookSetup referencing existing secret", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-webhook",
      displayName: "Test Webhook",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        webhookSecret: {
          envVar: "WEBHOOK_SECRET",
          scope: "agent",
          isSecret: true,
        },
      },
      webhookSetup: {
        urlPath: "/hooks/test",
        secretKey: "webhookSecret",
        instructions: ["Step 1"],
        configJsonPath: "plugins.entries.test-webhook.config.webhookSecret",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects webhookSetup with secretKey referencing non-existent secret", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-bad-webhook",
      displayName: "Test Bad Webhook",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        apiKey: {
          envVar: "API_KEY",
          scope: "agent",
          isSecret: true,
        },
      },
      webhookSetup: {
        urlPath: "/hooks/test",
        secretKey: "nonExistentSecret",
        instructions: ["Step 1"],
        configJsonPath: "plugins.entries.test.config.webhookSecret",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.includes("webhookSetup") && i.path.includes("secretKey")
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("nonExistentSecret");
    }
  });

  it("validates Linear webhook configJsonPath uses openclaw-linear", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    expect(linearManifest.webhookSetup).toBeDefined();
    expect(linearManifest.webhookSetup!.configJsonPath).toContain("openclaw-linear");
    expect(linearManifest.webhookSetup!.configJsonPath).not.toMatch(
      /plugins\.entries\.linear\.config/
    );
  });

  it("validates Slack has channel-based configPath", () => {
    const slackManifest = PLUGIN_MANIFEST_REGISTRY["slack"];
    expect(slackManifest.configPath).toBe("channels");
  });

  it("validates Slack has dm config transform", () => {
    const slackManifest = PLUGIN_MANIFEST_REGISTRY["slack"];
    expect(slackManifest.configTransforms).toHaveLength(1);
    expect(slackManifest.configTransforms[0].sourceKey).toBe("dm");
    expect(slackManifest.configTransforms[0].removeSource).toBe(true);
    expect(slackManifest.configTransforms[0].targetKeys).toEqual({
      policy: "dmPolicy",
      allowFrom: "allowFrom",
    });
  });
});

// ---------------------------------------------------------------------------
// PluginHooksSchema and hooks validation
// ---------------------------------------------------------------------------

describe("PluginManifestSchema hooks field", () => {
  it("accepts manifest with resolve hook matching autoResolvable secret", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-hooks",
      displayName: "Test Hooks",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        mySecret: {
          envVar: "MY_SECRET",
          scope: "agent",
          isSecret: false,
          autoResolvable: true,
        },
      },
      hooks: {
        resolve: {
          mySecret: "echo test-value",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest without hooks (backward compatibility)", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-no-hooks",
      displayName: "Test No Hooks",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks).toBeUndefined();
    }
  });

  it("rejects resolve hook key referencing nonexistent secret", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-bad-resolve",
      displayName: "Test Bad Resolve",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        existingSecret: {
          envVar: "EXISTING",
          scope: "agent",
          isSecret: false,
          autoResolvable: true,
        },
      },
      hooks: {
        resolve: {
          nonExistentSecret: "echo value",
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes("does not correspond to any secret")
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("nonExistentSecret");
    }
  });

  it("rejects resolve hook for secret that is not autoResolvable", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-not-auto",
      displayName: "Test Not Auto",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        manualSecret: {
          envVar: "MANUAL_SECRET",
          scope: "agent",
          isSecret: true,
          autoResolvable: false,
        },
      },
      hooks: {
        resolve: {
          manualSecret: "echo value",
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes("not autoResolvable")
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("manualSecret");
    }
  });

  it("rejects empty resolve hook script", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-empty-script",
      displayName: "Test Empty Script",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        mySecret: {
          envVar: "MY_SECRET",
          scope: "agent",
          isSecret: false,
          autoResolvable: true,
        },
      },
      hooks: {
        resolve: {
          mySecret: "",
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes("cannot be empty")
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects empty postProvision hook script", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-empty-post",
      displayName: "Test Empty Post",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
      hooks: {
        postProvision: "",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes("cannot be empty")
      );
      expect(issue).toBeDefined();
    }
  });

  it("accepts manifest with all hook types", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-all-hooks",
      displayName: "Test All Hooks",
      installable: true,
      configPath: "plugins.entries",
      secrets: {
        uuid: {
          envVar: "UUID",
          scope: "agent",
          isSecret: false,
          autoResolvable: true,
        },
      },
      hooks: {
        resolve: {
          uuid: "echo abc-123",
        },
        postProvision: "npm install -g some-tool",
        preStart: "echo ready",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.resolve?.uuid).toBe("echo abc-123");
      expect(result.data.hooks?.postProvision).toBe("npm install -g some-tool");
      expect(result.data.hooks?.preStart).toBe("echo ready");
    }
  });

  it("validates openclaw-linear has resolve hook for linearUserUuid", () => {
    const linearManifest = PLUGIN_MANIFEST_REGISTRY["openclaw-linear"];
    expect(linearManifest.hooks).toBeDefined();
    expect(linearManifest.hooks?.resolve).toBeDefined();
    expect(linearManifest.hooks?.resolve?.linearUserUuid).toBeDefined();
    expect(linearManifest.hooks?.resolve?.linearUserUuid).toContain("LINEAR_API_KEY");
    expect(linearManifest.hooks?.resolve?.linearUserUuid).toContain("viewer");
  });

  it("accepts manifest with valid onboard hook", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-onboard",
      displayName: "Test Onboard",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
      hooks: {
        onboard: {
          description: "Create external app",
          inputs: {
            configToken: {
              envVar: "CONFIG_TOKEN",
              prompt: "Enter your config token:",
              instructions: "Generate at https://example.com/tokens",
              validator: "xoxe-",
            },
          },
          script: 'echo "Follow these steps..."',
          runOnce: true,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.onboard?.description).toBe("Create external app");
      expect(result.data.hooks?.onboard?.runOnce).toBe(true);
      expect(result.data.hooks?.onboard?.inputs.configToken.envVar).toBe("CONFIG_TOKEN");
    }
  });

  it("rejects onboard hook without script", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-no-script",
      displayName: "Test No Script",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
      hooks: {
        onboard: {
          description: "Missing script",
          inputs: {},
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects onboard hook with empty script", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-empty-script",
      displayName: "Test Empty",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
      hooks: {
        onboard: {
          description: "Empty script",
          inputs: {},
          script: "",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts onboard hook with empty inputs", () => {
    const result = PluginManifestSchema.safeParse({
      name: "test-no-inputs",
      displayName: "Test No Inputs",
      installable: true,
      configPath: "plugins.entries",
      secrets: {},
      hooks: {
        onboard: {
          description: "No inputs needed",
          script: 'echo "done"',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.onboard?.inputs).toEqual({});
      expect(result.data.hooks?.onboard?.runOnce).toBe(false);
    }
  });
});
