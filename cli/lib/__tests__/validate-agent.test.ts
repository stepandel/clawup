import { describe, it, expect } from "vitest";
import { validateAgentDefinition, type AgentDefinition } from "../../types";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "agent-test",
    displayName: "Test",
    role: "eng",
    preset: "eng",
    volumeSize: 30,
    ...overrides,
  };
}

describe("validateAgentDefinition", () => {
  it("accepts a valid preset-based agent", () => {
    expect(() => validateAgentDefinition(makeAgent())).not.toThrow();
  });

  it("accepts a valid identity-based agent", () => {
    expect(() =>
      validateAgentDefinition(
        makeAgent({ preset: null, identity: "https://github.com/org/identities#juno" })
      )
    ).not.toThrow();
  });

  it("rejects agent with both preset and identity", () => {
    expect(() =>
      validateAgentDefinition(
        makeAgent({ preset: "pm", identity: "https://github.com/org/identities#juno" })
      )
    ).toThrow("mutually exclusive");
  });

  it("rejects agent with neither preset, identity, nor soulContent", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ preset: null }))
    ).toThrow('must specify either "preset", "identity"');
  });

  it("allows custom agent with soulContent but no preset/identity", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ preset: null, soulContent: "# Soul" }))
    ).not.toThrow();
  });

  it("rejects identityVersion without identity", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ identityVersion: "v1.0.0" }))
    ).toThrow('"identityVersion" requires "identity"');
  });

  it("accepts identityVersion with identity", () => {
    expect(() =>
      validateAgentDefinition(
        makeAgent({
          preset: null,
          identity: "https://github.com/org/ids#juno",
          identityVersion: "v1.0.0",
        })
      )
    ).not.toThrow();
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

  it("accepts deprecated soulContent/identityContent for custom agents", () => {
    expect(() =>
      validateAgentDefinition(
        makeAgent({ preset: null, soulContent: "# Soul", identityContent: "# Identity" })
      )
    ).not.toThrow();
  });

  it("accepts a valid plugins array", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ plugins: ["openclaw-linear"] }))
    ).not.toThrow();
  });

  it("accepts an empty plugins array", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ plugins: [] }))
    ).not.toThrow();
  });

  it("rejects non-string plugin entries", () => {
    expect(() =>
      validateAgentDefinition(makeAgent({ plugins: ["openclaw-linear", "" as string] }))
    ).toThrow("non-empty string");
  });

  it("accepts agent without plugins field", () => {
    expect(() =>
      validateAgentDefinition(makeAgent())
    ).not.toThrow();
  });
});
