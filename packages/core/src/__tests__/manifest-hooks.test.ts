import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runResolveHook, runLifecycleHook, resolvePluginSecrets } from "../manifest-hooks";
import type { PluginManifest } from "../plugin-registry";

describe("runResolveHook", () => {
  it("captures stdout as the resolved value", async () => {
    const result = await runResolveHook({
      script: 'echo "test-uuid"',
      env: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("test-uuid");
    }
  });

  it("trims whitespace from resolved value", async () => {
    const result = await runResolveHook({
      script: 'echo "  value  "',
      env: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("value");
    }
  });

  it("returns error on timeout", async () => {
    const result = await runResolveHook({
      script: "sleep 60",
      env: {},
      timeoutMs: 500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("timed out");
    }
  });

  it("returns error on non-zero exit code", async () => {
    const result = await runResolveHook({
      script: 'echo "oops" >&2; exit 1',
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exited with code 1");
      expect(result.error).toContain("oops");
    }
  });

  it("returns error on empty stdout", async () => {
    const result = await runResolveHook({
      script: "echo -n ''",
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty output");
    }
  });

  it("inherits provided env vars", async () => {
    const result = await runResolveHook({
      script: 'echo "$MY_TEST_VAR"',
      env: { MY_TEST_VAR: "hello-from-env" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("hello-from-env");
    }
  });
});

describe("runLifecycleHook", () => {
  it("returns success for a passing script", async () => {
    const result = await runLifecycleHook({
      script: "echo installing...",
      label: "postProvision",
    });
    expect(result.ok).toBe(true);
  });

  it("returns error on non-zero exit", async () => {
    const result = await runLifecycleHook({
      script: "exit 1",
      label: "preStart",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("preStart");
      expect(result.error).toContain("exited with code 1");
    }
  });

  it("returns error on timeout", async () => {
    const result = await runLifecycleHook({
      script: "sleep 60",
      label: "postProvision",
      timeoutMs: 500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("timed out");
    }
  });
});

describe("resolvePluginSecrets", () => {
  const baseManifest: PluginManifest = {
    name: "test-plugin",
    displayName: "Test Plugin",
    installable: true,
    configPath: "plugins.entries",
    needsFunnel: false,
    internalKeys: [],
    configTransforms: [],
    secrets: {
      myUuid: {
        envVar: "MY_UUID",
        scope: "agent",
        isSecret: false,
        required: false,
        autoResolvable: true,
      },
      myToken: {
        envVar: "MY_TOKEN",
        scope: "agent",
        isSecret: true,
        required: true,
        autoResolvable: true,
      },
    },
    hooks: {
      resolve: {
        myUuid: 'echo "uuid-123"',
        myToken: 'echo "token-abc"',
      },
    },
  };

  it("resolves all autoResolvable secrets", async () => {
    const result = await resolvePluginSecrets({
      manifest: baseManifest,
      env: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values).toEqual({
        MY_UUID: "uuid-123",
        MY_TOKEN: "token-abc",
      });
    }
  });

  it("returns empty values when no resolve hooks exist", async () => {
    const noHooksManifest: PluginManifest = {
      ...baseManifest,
      hooks: undefined,
    };
    const result = await resolvePluginSecrets({
      manifest: noHooksManifest,
      env: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values).toEqual({});
    }
  });

  it("fails fast on first resolve hook error", async () => {
    const failManifest: PluginManifest = {
      ...baseManifest,
      hooks: {
        resolve: {
          myUuid: 'echo "uuid-123"',
          myToken: "exit 1",
        },
      },
    };
    const result = await resolvePluginSecrets({
      manifest: failManifest,
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("myToken");
    }
  });
});
