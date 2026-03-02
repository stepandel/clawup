/**
 * Regression tests for Linear plugin agentMapping generation.
 *
 * Ensures the `$AGENT_NAME` placeholder bug does not resurface and that
 * linearUserUuid is correctly resolved from both inline config and
 * Pulumi config fallback.
 */

import { describe, it, expect } from "vitest";
import { buildLinearAgentMapping, type LinearMappingInput } from "../linear-mapping";

const BASE_INPUT: LinearMappingInput = {
  agentDisplayName: "Juno",
  agentName: "agent-pm",
};

describe("buildLinearAgentMapping", () => {
  it("uses agent displayName as the mapping key (not a placeholder)", () => {
    const mapping = buildLinearAgentMapping(BASE_INPUT);
    expect(mapping).toEqual({ Juno: "default" });
    expect(Object.keys(mapping)).not.toContain("$AGENT_NAME");
  });

  it("includes UUID from inline config when provided", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      configUuid: "uuid-from-config",
    });
    expect(mapping).toEqual({
      "uuid-from-config": "default",
      Juno: "default",
    });
  });

  it("falls back to Pulumi config UUID when inline config is missing", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      pulumiConfigUuid: "uuid-from-pulumi",
    });
    expect(mapping).toEqual({
      "uuid-from-pulumi": "default",
      Juno: "default",
    });
  });

  it("prefers inline configUuid over pulumiConfigUuid", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      configUuid: "inline-uuid",
      pulumiConfigUuid: "pulumi-uuid",
    });
    expect(mapping).toEqual({
      "inline-uuid": "default",
      Juno: "default",
    });
    expect(Object.keys(mapping)).not.toContain("pulumi-uuid");
  });

  it("omits UUID entry when neither config source provides one", () => {
    const mapping = buildLinearAgentMapping(BASE_INPUT);
    expect(Object.keys(mapping)).toHaveLength(1);
    expect(mapping).toEqual({ Juno: "default" });
  });

  it("falls back to identityDisplayName when agentDisplayName is empty", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      agentDisplayName: "",
      identityDisplayName: "Identity PM",
    });
    expect(mapping).toEqual({ "Identity PM": "default" });
  });

  it("falls back to agentName when both display names are empty", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      agentDisplayName: "",
      identityDisplayName: "",
    });
    expect(mapping).toEqual({ "agent-pm": "default" });
  });

  it("falls back to agentName when identityDisplayName is undefined", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      agentDisplayName: "",
    });
    expect(mapping).toEqual({ "agent-pm": "default" });
  });

  it("produces both UUID and name entries for full routing support", () => {
    const mapping = buildLinearAgentMapping({
      ...BASE_INPUT,
      configUuid: "abc-123",
    });
    const keys = Object.keys(mapping);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("abc-123");
    expect(keys).toContain("Juno");
    // All values should be "default" queue
    expect(Object.values(mapping).every((v) => v === "default")).toBe(true);
  });
});
