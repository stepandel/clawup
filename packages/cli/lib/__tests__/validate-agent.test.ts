import { describe, it, expect } from "vitest";
import { validateAgentDefinition, type AgentDefinition } from "@agent-army/core";

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

  it("rejects non-positive volumeSize", () => {
    expect(() => validateAgentDefinition(makeAgent({ volumeSize: 0 }))).toThrow("positive number");
    expect(() => validateAgentDefinition(makeAgent({ volumeSize: -5 }))).toThrow("positive number");
  });

  it("rejects missing required fields", () => {
    expect(() =>
      validateAgentDefinition({ ...makeAgent(), name: "" })
    ).toThrow('missing required field "name"');

    expect(() =>
      validateAgentDefinition({ ...makeAgent(), displayName: "" })
    ).toThrow('missing required field "displayName"');

    expect(() =>
      validateAgentDefinition({ ...makeAgent(), role: "" })
    ).toThrow('missing required field "role"');
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
