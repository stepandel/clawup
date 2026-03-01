import { describe, it, expect } from "vitest";
import {
  AgentDefinitionSchema,
  ClawupManifestSchema,
  HooksSchema,
  IdentityManifestSchema,
} from "../schemas";

describe("AgentDefinitionSchema", () => {
  const validAgent = {
    name: "agent-pm",
    displayName: "Juno",
    role: "pm",
    identity: "https://github.com/org/identities#pm",
    volumeSize: 30,
  };

  it("accepts a valid agent definition", () => {
    expect(() => AgentDefinitionSchema.parse(validAgent)).not.toThrow();
  });

  it("accepts agent with optional fields", () => {
    const result = AgentDefinitionSchema.parse({
      ...validAgent,
      identityVersion: "v1.0",
      instanceType: "t3.large",
      envVars: { FOO: "bar" },
      plugins: { "openclaw-linear": { agentId: "agent-pm" } },
    });
    expect(result.plugins).toEqual({ "openclaw-linear": { agentId: "agent-pm" } });
  });

  it("rejects empty object (missing identity)", () => {
    const result = AgentDefinitionSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("identity");
    }
  });

  it("accepts agent with only identity (name/displayName/role/volumeSize optional)", () => {
    const result = AgentDefinitionSchema.safeParse({ identity: "./pm" });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive volumeSize", () => {
    const result = AgentDefinitionSchema.safeParse({ ...validAgent, volumeSize: 0 });
    expect(result.success).toBe(false);
  });
});

describe("ClawupManifestSchema", () => {
  const validManifest = {
    stackName: "dev",
    provider: "aws",
    region: "us-east-1",
    instanceType: "t3.medium",
    ownerName: "Boss",
    agents: [
      {
        name: "agent-pm",
        displayName: "Juno",
        role: "pm",
        identity: "https://github.com/org/identities#pm",
        volumeSize: 30,
      },
    ],
  };

  it("accepts a valid manifest", () => {
    expect(() => ClawupManifestSchema.parse(validManifest)).not.toThrow();
  });

  it("rejects manifest with no agents", () => {
    const result = ClawupManifestSchema.safeParse({ ...validManifest, agents: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const result = ClawupManifestSchema.safeParse({ ...validManifest, provider: "gcp" });
    expect(result.success).toBe(false);
  });
});

describe("IdentityManifestSchema", () => {
  const validIdentity = {
    name: "juno",
    displayName: "Juno",
    role: "pm",
    emoji: "clipboard",
    description: "Product manager agent",
    volumeSize: 30,
    skills: ["pm-queue-handler"],
    templateVars: ["OWNER_NAME"],
  };

  it("accepts a valid identity manifest", () => {
    expect(() => IdentityManifestSchema.parse(validIdentity)).not.toThrow();
  });

  it("rejects identity missing required fields", () => {
    const result = IdentityManifestSchema.safeParse({ name: "only-name" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("role");
      expect(paths).toContain("volumeSize");
      expect(paths).toContain("skills");
    }
  });

  it("rejects non-positive volumeSize", () => {
    const result = IdentityManifestSchema.safeParse({ ...validIdentity, volumeSize: 0 });
    expect(result.success).toBe(false);
  });

  it("validates plugins as array of non-empty strings", () => {
    const result = IdentityManifestSchema.safeParse({
      ...validIdentity,
      plugins: ["openclaw-linear", ""],
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = IdentityManifestSchema.parse({
      ...validIdentity,
      model: "anthropic/claude-opus-4-6",
      backupModel: "anthropic/claude-sonnet-4-5",
      codingAgent: "claude-code",
      deps: ["gh"],
      pluginDefaults: { "openclaw-linear": { key: "value" } },
    });
    expect(result.model).toBe("anthropic/claude-opus-4-6");
    expect(result.deps).toEqual(["gh"]);
  });
});

// ---------------------------------------------------------------------------
// HooksSchema on ClawupManifestSchema (swarm-level hooks)
// ---------------------------------------------------------------------------

describe("ClawupManifestSchema — hooks field", () => {
  const validManifest = {
    stackName: "dev",
    provider: "aws",
    region: "us-east-1",
    instanceType: "t3.medium",
    ownerName: "Boss",
    agents: [{ identity: "./pm" }],
  };

  it("accepts manifest without hooks (backward compatibility)", () => {
    const result = ClawupManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks).toBeUndefined();
    }
  });

  it("accepts manifest with all hook types", () => {
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: {
        postProvision: "curl -sSL https://install.example.com | sh",
        preStart: "monitoring-agent start",
        resolve: { TEAM_ID: 'curl -s https://api.example.com/team | jq -r .id' },
        onboard: {
          description: "Register deployment webhook",
          script: 'curl -X POST https://api.example.com/webhooks',
          runOnce: true,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.postProvision).toContain("install.example.com");
      expect(result.data.hooks?.preStart).toBe("monitoring-agent start");
      expect(result.data.hooks?.resolve?.TEAM_ID).toContain("jq");
      expect(result.data.hooks?.onboard?.runOnce).toBe(true);
    }
  });

  it("accepts manifest with only postProvision hook", () => {
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: { postProvision: "echo hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts manifest with only resolve hooks", () => {
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: { resolve: { MY_VAR: "echo val" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty postProvision script", () => {
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: { postProvision: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty preStart script", () => {
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: { preStart: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty resolve hook script value", () => {
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: { resolve: { TEAM_ID: "" } },
    });
    expect(result.success).toBe(false);
  });

  it("swarm hooks do not require plugin secrets cross-validation", () => {
    // Unlike plugin-level resolve, swarm resolve keys are env var names directly
    const result = ClawupManifestSchema.safeParse({
      ...validManifest,
      hooks: { resolve: { ANY_ENV_VAR: "echo value" } },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HooksSchema on IdentityManifestSchema (identity-level hooks)
// ---------------------------------------------------------------------------

describe("IdentityManifestSchema — hooks field", () => {
  const validIdentity = {
    name: "juno",
    displayName: "Juno",
    role: "pm",
    emoji: "clipboard",
    description: "Product manager agent",
    volumeSize: 30,
    skills: ["pm-queue-handler"],
    templateVars: ["OWNER_NAME"],
  };

  it("accepts identity without hooks (backward compatibility)", () => {
    const result = IdentityManifestSchema.safeParse(validIdentity);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks).toBeUndefined();
    }
  });

  it("accepts identity with all hook types", () => {
    const result = IdentityManifestSchema.safeParse({
      ...validIdentity,
      hooks: {
        postProvision: "npm install -g pm-tools",
        preStart: "pm-tools init",
        resolve: { PM_TOKEN: "echo tok-123" },
        onboard: {
          description: "Register PM workspace",
          script: 'echo "Workspace created"',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.postProvision).toContain("pm-tools");
      expect(result.data.hooks?.preStart).toBe("pm-tools init");
      expect(result.data.hooks?.resolve?.PM_TOKEN).toContain("tok-123");
      expect(result.data.hooks?.onboard?.description).toBe("Register PM workspace");
    }
  });

  it("accepts identity with only lifecycle hooks", () => {
    const result = IdentityManifestSchema.safeParse({
      ...validIdentity,
      hooks: { postProvision: "apt-get install -y jq" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty hook scripts", () => {
    const result = IdentityManifestSchema.safeParse({
      ...validIdentity,
      hooks: { postProvision: "" },
    });
    expect(result.success).toBe(false);
  });

  it("identity hooks do not require plugin secrets cross-validation", () => {
    const result = IdentityManifestSchema.safeParse({
      ...validIdentity,
      hooks: { resolve: { CUSTOM_SECRET: "curl -s https://api.example.com/secret" } },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HooksSchema standalone
// ---------------------------------------------------------------------------

describe("HooksSchema", () => {
  it("accepts empty object", () => {
    const result = HooksSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("all fields are optional", () => {
    const result = HooksSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resolve).toBeUndefined();
      expect(result.data.postProvision).toBeUndefined();
      expect(result.data.preStart).toBeUndefined();
      expect(result.data.onboard).toBeUndefined();
    }
  });

  it("accepts all four hook types together", () => {
    const result = HooksSchema.safeParse({
      resolve: { KEY_A: "echo a", KEY_B: "echo b" },
      postProvision: "install.sh",
      preStart: "start.sh",
      onboard: { description: "Setup", script: "setup.sh" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.resolve!)).toHaveLength(2);
    }
  });

  it("accepts multiple resolve keys", () => {
    const result = HooksSchema.safeParse({
      resolve: {
        TEAM_ID: "echo team-1",
        PROJECT_ID: "echo proj-2",
        ORG_NAME: "echo my-org",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.resolve!)).toHaveLength(3);
    }
  });
});
