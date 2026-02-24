import { describe, it, expect } from "vitest";
import { resolve } from "path";
import type { ClawupManifest } from "@clawup/core";
import { resolveIdentityPaths } from "../config";

/** Helper to build a minimal valid manifest with the given identity strings. */
function makeManifest(identities: string[]): ClawupManifest {
  return {
    stackName: "test-stack",
    provider: "aws",
    region: "us-east-1",
    instanceType: "t3.medium",
    ownerName: "tester",
    agents: identities.map((identity, i) => ({
      name: `agent-${i}`,
      displayName: `Agent ${i}`,
      role: "eng",
      identity,
      volumeSize: 30,
    })),
  };
}

describe("resolveIdentityPaths", () => {
  const projectRoot = "/home/user/my-project";

  it("resolves ./ relative paths to absolute paths", () => {
    const manifest = makeManifest(["./identities/pm"]);
    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].identity).toBe(
      resolve(projectRoot, "./identities/pm"),
    );
    expect(result.agents[0].identity).toBe("/home/user/my-project/identities/pm");
  });

  it("resolves ../ relative paths to absolute paths", () => {
    const manifest = makeManifest(["../shared/identities/eng"]);
    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].identity).toBe(
      resolve(projectRoot, "../shared/identities/eng"),
    );
    expect(result.agents[0].identity).toBe("/home/user/shared/identities/eng");
  });

  it("leaves absolute paths unchanged", () => {
    const manifest = makeManifest(["/opt/identities/qa"]);
    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].identity).toBe("/opt/identities/qa");
  });

  it("leaves HTTPS git URLs unchanged", () => {
    const url = "https://github.com/org/identities#pm";
    const manifest = makeManifest([url]);
    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].identity).toBe(url);
  });

  it("leaves SSH git URLs unchanged", () => {
    const url = "git@github.com:org/identities#eng";
    const manifest = makeManifest([url]);
    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].identity).toBe(url);
  });

  it("handles a mix of relative, absolute, and git URL identities", () => {
    const manifest = makeManifest([
      "./identities/pm",
      "https://github.com/org/identities#eng",
      "../shared/qa",
      "/abs/path/tester",
      "git@github.com:org/ids#ops",
    ]);
    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].identity).toBe("/home/user/my-project/identities/pm");
    expect(result.agents[1].identity).toBe("https://github.com/org/identities#eng");
    expect(result.agents[2].identity).toBe("/home/user/shared/qa");
    expect(result.agents[3].identity).toBe("/abs/path/tester");
    expect(result.agents[4].identity).toBe("git@github.com:org/ids#ops");
  });

  it("does not mutate the original manifest", () => {
    const manifest = makeManifest(["./identities/pm"]);
    const original = manifest.agents[0].identity;
    resolveIdentityPaths(manifest, projectRoot);

    expect(manifest.agents[0].identity).toBe(original);
  });

  it("preserves all other agent fields", () => {
    const manifest = makeManifest(["./identities/pm"]);
    manifest.agents[0].envVars = { FOO: "bar" };
    manifest.agents[0].plugins = { "my-plugin": { key: "val" } };

    const result = resolveIdentityPaths(manifest, projectRoot);

    expect(result.agents[0].name).toBe("agent-0");
    expect(result.agents[0].displayName).toBe("Agent 0");
    expect(result.agents[0].role).toBe("eng");
    expect(result.agents[0].volumeSize).toBe(30);
    expect(result.agents[0].envVars).toEqual({ FOO: "bar" });
    expect(result.agents[0].plugins).toEqual({ "my-plugin": { key: "val" } });
  });
});
