import { describe, it, expect } from "vitest";
import {
  AgentDefinitionSchema,
  ClawupManifestSchema,
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
