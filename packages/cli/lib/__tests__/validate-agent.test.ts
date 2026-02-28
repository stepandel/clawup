import { describe, it, expect } from "vitest";
import { validateAgentDefinition, type AgentDefinition } from "@clawup/core";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "agent-test",
    displayName: "Test",
    role: "eng",
    identity: "https://github.com/org/identities#eng",
    volumeSize: 30,
    ...overrides,
  };
}

describe("validateAgentDefinition", () => {
  it("accepts a valid identity-based agent", () => {
    expect(() => validateAgentDefinition(makeAgent())).not.toThrow();
  });

  it("rejects agent missing identity", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ identity: "" }))
    ).toThrow('missing required field "identity"');
  });

  it("accepts agent with non-positive volumeSize (schema validates this)", () => {
    // Runtime validateAgentDefinition only checks identity.
    // Volume size validation is handled by the Zod schema (AgentDefinitionSchema).
    expect(() => validateAgentDefinition(makeAgent({ volumeSize: 0 }))).not.toThrow();
  });

  it("accepts agent without name/displayName/role (optional, resolved from identity)", () => {
    expect(() =>
      validateAgentDefinition({ identity: "./pm" })
    ).not.toThrow();
  });

  it("accepts agent with optional instanceType override", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ instanceType: "t3.large" }))
    ).not.toThrow();
  });

  it("accepts agent with optional envVars", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ envVars: { FOO: "bar" } }))
    ).not.toThrow();
  });
});
