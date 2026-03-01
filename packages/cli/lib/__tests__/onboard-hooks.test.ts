/**
 * Unit tests for multi-level onboard hooks.
 *
 * Tests the execution ordering: swarm → identity → plugin,
 * skip behavior, error handling, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runOnboardHooks } from "../onboard-hooks";
import type { IdentityResult, PluginManifest } from "@clawup/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Track the order of hook execution */
let executionLog: string[] = [];

/** Create a mock PromptLike */
function mockPrompt() {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    text: vi.fn(async () => "mock-input"),
    isCancel: () => false,
  };
}

/** Build a minimal IdentityResult */
function makeIdentityResult(overrides?: {
  name?: string;
  hooks?: IdentityResult["manifest"]["hooks"];
  plugins?: string[];
}): IdentityResult {
  return {
    manifest: {
      name: overrides?.name ?? "test-agent",
      displayName: overrides?.name ?? "Test Agent",
      role: "tester",
      emoji: "test_tube",
      description: "test",
      volumeSize: 30,
      skills: [],
      templateVars: [],
      plugins: overrides?.plugins,
      hooks: overrides?.hooks,
    },
    files: {},
  };
}

/** Build a minimal PluginManifest with an onboard hook */
function makePluginManifest(
  name: string,
  onboard?: PluginManifest["hooks"],
): PluginManifest {
  return {
    name,
    displayName: name,
    installable: true,
    needsFunnel: false,
    configPath: "plugins.entries",
    secrets: {},
    internalKeys: [],
    configTransforms: [],
    hooks: onboard,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  executionLog = [];
});

describe("runOnboardHooks — multi-level execution", () => {
  it("runs swarm onboard hook before per-agent hooks", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async (opts: { script: string }) => {
      executionLog.push(opts.script);
      return { ok: true as const, instructions: "" };
    });

    const identityResult = makeIdentityResult({ plugins: ["my-plugin"] });

    await runOnboardHooks({
      fetchedIdentities: [
        { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult },
      ],
      agentPlugins: new Map([["a1", new Set(["my-plugin"])]]),
      resolvePlugin: () =>
        makePluginManifest("my-plugin", {
          onboard: {
            description: "Plugin setup",
            inputs: {},
            script: "plugin-script",
            runOnce: false,
          },
        }),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      swarmOnboard: {
        description: "Swarm setup",
        inputs: {},
        script: "swarm-script",
        runOnce: false,
      },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    expect(executionLog).toEqual(["swarm-script", "plugin-script"]);
  });

  it("runs identity onboard hook between swarm and plugin", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async (opts: { script: string }) => {
      executionLog.push(opts.script);
      return { ok: true as const, instructions: "" };
    });

    const identityResult = makeIdentityResult({
      name: "juno",
      plugins: ["my-plugin"],
      hooks: {
        onboard: {
          description: "Identity setup",
          inputs: {},
          script: "identity-script",
          runOnce: false,
        },
      },
    });

    await runOnboardHooks({
      fetchedIdentities: [
        { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult },
      ],
      agentPlugins: new Map([["a1", new Set(["my-plugin"])]]),
      resolvePlugin: () =>
        makePluginManifest("my-plugin", {
          onboard: {
            description: "Plugin setup",
            inputs: {},
            script: "plugin-script",
            runOnce: false,
          },
        }),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      swarmOnboard: {
        description: "Swarm setup",
        inputs: {},
        script: "swarm-script",
        runOnce: false,
      },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    // Order: swarm → identity → plugin
    expect(executionLog).toEqual(["swarm-script", "identity-script", "plugin-script"]);
  });

  it("runs all three levels for multiple agents", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async (opts: { script: string }) => {
      executionLog.push(opts.script);
      return { ok: true as const, instructions: "" };
    });

    const identity1 = makeIdentityResult({
      name: "juno",
      plugins: ["plugin-a"],
      hooks: {
        onboard: {
          description: "Identity 1",
          inputs: {},
          script: "identity-1-script",
          runOnce: false,
        },
      },
    });

    const identity2 = makeIdentityResult({
      name: "titus",
      plugins: ["plugin-b"],
      hooks: {
        onboard: {
          description: "Identity 2",
          inputs: {},
          script: "identity-2-script",
          runOnce: false,
        },
      },
    });

    await runOnboardHooks({
      fetchedIdentities: [
        { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult: identity1 },
        { agent: { name: "a2", role: "eng", displayName: "Titus" }, identityResult: identity2 },
      ],
      agentPlugins: new Map([
        ["a1", new Set(["plugin-a"])],
        ["a2", new Set(["plugin-b"])],
      ]),
      resolvePlugin: (pluginName: string) =>
        makePluginManifest(pluginName, {
          onboard: {
            description: `${pluginName} setup`,
            inputs: {},
            script: `${pluginName}-script`,
            runOnce: false,
          },
        }),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      swarmOnboard: {
        description: "Swarm",
        inputs: {},
        script: "swarm-script",
        runOnce: false,
      },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    // Swarm runs once, then each agent: identity → plugin
    expect(executionLog).toEqual([
      "swarm-script",
      "identity-1-script",
      "plugin-a-script",
      "identity-2-script",
      "plugin-b-script",
    ]);
  });

  it("skips all hooks when skipOnboard is true", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async () => ({
      ok: true as const,
      instructions: "",
    }));

    await runOnboardHooks({
      fetchedIdentities: [
        {
          agent: { name: "a1", role: "pm", displayName: "Juno" },
          identityResult: makeIdentityResult({
            hooks: {
              onboard: { description: "x", inputs: {}, script: "y", runOnce: false },
            },
          }),
        },
      ],
      agentPlugins: new Map([["a1", new Set()]]),
      resolvePlugin: () => makePluginManifest("unused"),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      swarmOnboard: {
        description: "Swarm",
        inputs: {},
        script: "swarm-script",
        runOnce: false,
      },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: true,
    });

    expect(mockRunOnboardHook).not.toHaveBeenCalled();
    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Onboard hooks skipped"),
    );
  });

  it("no swarmOnboard: runs identity and plugin only", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async (opts: { script: string }) => {
      executionLog.push(opts.script);
      return { ok: true as const, instructions: "" };
    });

    const identityResult = makeIdentityResult({
      name: "juno",
      plugins: ["my-plugin"],
      hooks: {
        onboard: {
          description: "Identity",
          inputs: {},
          script: "identity-script",
          runOnce: false,
        },
      },
    });

    await runOnboardHooks({
      fetchedIdentities: [
        { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult },
      ],
      agentPlugins: new Map([["a1", new Set(["my-plugin"])]]),
      resolvePlugin: () =>
        makePluginManifest("my-plugin", {
          onboard: {
            description: "Plugin",
            inputs: {},
            script: "plugin-script",
            runOnce: false,
          },
        }),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      // no swarmOnboard
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    expect(executionLog).toEqual(["identity-script", "plugin-script"]);
  });

  it("no identity hooks, no plugin hooks: only swarm runs", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async (opts: { script: string }) => {
      executionLog.push(opts.script);
      return { ok: true as const, instructions: "" };
    });

    await runOnboardHooks({
      fetchedIdentities: [
        {
          agent: { name: "a1", role: "pm", displayName: "Juno" },
          identityResult: makeIdentityResult(),
        },
      ],
      agentPlugins: new Map([["a1", new Set()]]),
      resolvePlugin: () => makePluginManifest("unused"),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      swarmOnboard: {
        description: "Swarm only",
        inputs: {},
        script: "swarm-only-script",
        runOnce: false,
      },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    expect(executionLog).toEqual(["swarm-only-script"]);
  });

  it("no hooks at any level: nothing runs", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async () => ({
      ok: true as const,
      instructions: "",
    }));

    await runOnboardHooks({
      fetchedIdentities: [
        {
          agent: { name: "a1", role: "pm", displayName: "Juno" },
          identityResult: makeIdentityResult(),
        },
      ],
      agentPlugins: new Map([["a1", new Set()]]),
      resolvePlugin: () => makePluginManifest("unused"),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      // no swarmOnboard
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    expect(mockRunOnboardHook).not.toHaveBeenCalled();
  });
});

describe("runOnboardHooks — error handling", () => {
  it("swarm onboard failure calls exitWithError", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async () => ({
      ok: false as const,
      error: "swarm hook failed",
    }));

    await expect(
      runOnboardHooks({
        fetchedIdentities: [],
        agentPlugins: new Map(),
        resolvePlugin: () => makePluginManifest("unused"),
        autoResolvedSecrets: {},
        envDict: {},
        resolvedSecrets: { perAgent: {} },
        swarmOnboard: {
          description: "Swarm",
          inputs: {},
          script: "bad-script",
          runOnce: false,
        },
        p,
        runOnboardHook: mockRunOnboardHook,
        exitWithError: (msg: string) => { throw new Error(msg); },
        skipOnboard: false,
      }),
    ).rejects.toThrow("Swarm onboard hook failed");

    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining("swarm hook failed"),
    );
  });

  it("identity onboard failure calls exitWithError", async () => {
    const p = mockPrompt();
    let callCount = 0;
    const mockRunOnboardHook = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // swarm succeeds
        return { ok: true as const, instructions: "" };
      }
      // identity fails
      return { ok: false as const, error: "identity hook failed" };
    });

    const identityResult = makeIdentityResult({
      name: "juno",
      hooks: {
        onboard: {
          description: "Identity setup",
          inputs: {},
          script: "bad-identity-script",
          runOnce: false,
        },
      },
    });

    await expect(
      runOnboardHooks({
        fetchedIdentities: [
          { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult },
        ],
        agentPlugins: new Map([["a1", new Set()]]),
        resolvePlugin: () => makePluginManifest("unused"),
        autoResolvedSecrets: {},
        envDict: {},
        resolvedSecrets: { perAgent: {} },
        swarmOnboard: {
          description: "Swarm",
          inputs: {},
          script: "swarm-script",
          runOnce: false,
        },
        p,
        runOnboardHook: mockRunOnboardHook,
        exitWithError: (msg: string) => { throw new Error(msg); },
        skipOnboard: false,
      }),
    ).rejects.toThrow("Identity onboard hook failed");
  });

  it("swarm onboard failure prevents identity and plugin hooks from running", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async () => ({
      ok: false as const,
      error: "swarm failed",
    }));

    const identityResult = makeIdentityResult({
      hooks: {
        onboard: {
          description: "Identity",
          inputs: {},
          script: "should-not-run",
          runOnce: false,
        },
      },
      plugins: ["my-plugin"],
    });

    await expect(
      runOnboardHooks({
        fetchedIdentities: [
          { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult },
        ],
        agentPlugins: new Map([["a1", new Set(["my-plugin"])]]),
        resolvePlugin: () =>
          makePluginManifest("my-plugin", {
            onboard: {
              description: "Plugin",
              inputs: {},
              script: "should-not-run-either",
              runOnce: false,
            },
          }),
        autoResolvedSecrets: {},
        envDict: {},
        resolvedSecrets: { perAgent: {} },
        swarmOnboard: {
          description: "Swarm",
          inputs: {},
          script: "bad-swarm",
          runOnce: false,
        },
        p,
        runOnboardHook: mockRunOnboardHook,
        exitWithError: (msg: string) => { throw new Error(msg); },
        skipOnboard: false,
      }),
    ).rejects.toThrow();

    // Only one call (swarm), identity and plugin never ran
    expect(mockRunOnboardHook).toHaveBeenCalledTimes(1);
  });
});

describe("runOnboardHooks — instructions output", () => {
  it("swarm onboard instructions are labeled correctly", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async () => ({
      ok: true as const,
      instructions: "Follow these steps for swarm",
    }));

    await runOnboardHooks({
      fetchedIdentities: [],
      agentPlugins: new Map(),
      resolvePlugin: () => makePluginManifest("unused"),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      swarmOnboard: {
        description: "Swarm setup",
        inputs: {},
        script: "echo done",
        runOnce: false,
      },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("swarm onboard"),
    );
  });

  it("identity onboard instructions are labeled with identity name", async () => {
    const p = mockPrompt();
    const mockRunOnboardHook = vi.fn(async () => ({
      ok: true as const,
      instructions: "Identity follow-up",
    }));

    const identityResult = makeIdentityResult({
      name: "juno",
      hooks: {
        onboard: {
          description: "Identity setup",
          inputs: {},
          script: "echo identity-done",
          runOnce: false,
        },
      },
    });

    await runOnboardHooks({
      fetchedIdentities: [
        { agent: { name: "a1", role: "pm", displayName: "Juno" }, identityResult },
      ],
      agentPlugins: new Map([["a1", new Set()]]),
      resolvePlugin: () => makePluginManifest("unused"),
      autoResolvedSecrets: {},
      envDict: {},
      resolvedSecrets: { perAgent: {} },
      p,
      runOnboardHook: mockRunOnboardHook,
      exitWithError: (msg: string) => { throw new Error(msg); },
      skipOnboard: false,
    });

    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("identity:juno"),
    );
  });
});
