import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fetchIdentity } from "@clawup/core/identity";

/** Helper to create a valid identity manifest object */
function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-agent",
    displayName: "Test Agent",
    role: "eng",
    emoji: "wrench",
    description: "A test agent",
    volumeSize: 30,
    skills: ["coding"],
    templateVars: ["OWNER_NAME"],
    ...overrides,
  };
}

/** Helper to scaffold an identity directory */
function createIdentityDir(
  baseDir: string,
  subfolder: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
): string {
  const dir = join(baseDir, subfolder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "identity.json"), JSON.stringify(manifest, null, 2));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("fetchIdentity", () => {
  let tmpDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "identity-test-"));
    cacheDir = join(tmpDir, "cache");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads identity from a local directory path", async () => {
    const dir = createIdentityDir(tmpDir, "my-agent", validManifest(), {
      "SOUL.md": "# Soul\nI am a test agent.",
      "IDENTITY.md": "# Identity\nTest identity.",
    });

    const result = await fetchIdentity(dir, cacheDir);

    expect(result.manifest.name).toBe("test-agent");
    expect(result.manifest.displayName).toBe("Test Agent");
    expect(result.manifest.role).toBe("eng");
    expect(result.manifest.volumeSize).toBe(30);
    expect(result.manifest.skills).toEqual(["coding"]);
    expect(result.manifest.templateVars).toEqual(["OWNER_NAME"]);
    expect(result.files["SOUL.md"]).toBe("# Soul\nI am a test agent.");
    expect(result.files["IDENTITY.md"]).toBe("# Identity\nTest identity.");
    // manifest file itself should NOT be in files
    expect(result.files["identity.json"]).toBeUndefined();
    expect(result.files["identity.yaml"]).toBeUndefined();
  });

  it("supports subfolder syntax for local paths", async () => {
    const baseDir = join(tmpDir, "mono-repo");
    createIdentityDir(baseDir, "agents/juno", validManifest({ name: "juno", displayName: "Juno" }), {
      "SOUL.md": "# Juno Soul",
    });

    const result = await fetchIdentity(join(baseDir, "agents", "juno"), cacheDir);

    expect(result.manifest.name).toBe("juno");
    expect(result.files["SOUL.md"]).toBe("# Juno Soul");
  });

  it("reads nested skill files", async () => {
    const dir = createIdentityDir(tmpDir, "with-skills", validManifest(), {
      "skills/my-skill/SKILL.md": "# My Skill",
      "skills/my-skill/refs/api.md": "API docs",
    });

    const result = await fetchIdentity(dir, cacheDir);

    expect(result.files["skills/my-skill/SKILL.md"]).toBe("# My Skill");
    expect(result.files["skills/my-skill/refs/api.md"]).toBe("API docs");
  });

  it("includes optional fields when present", async () => {
    const manifest = validManifest({
      instanceType: "t3.large",
      plugins: ["openclaw-linear"],
      pluginDefaults: {
        "openclaw-linear": {
          stateActions: { triage: "remove", backlog: "add" },
        },
      },
    });
    const dir = createIdentityDir(tmpDir, "optional", manifest);

    const result = await fetchIdentity(dir, cacheDir);

    expect(result.manifest.instanceType).toBe("t3.large");
    expect(result.manifest.plugins).toEqual(["openclaw-linear"]);
    expect(result.manifest.pluginDefaults).toEqual({
      "openclaw-linear": {
        stateActions: { triage: "remove", backlog: "add" },
      },
    });
  });

  it("throws when identity manifest is missing", async () => {
    const dir = join(tmpDir, "empty");
    mkdirSync(dir, { recursive: true });

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow("identity.yaml not found");
  });

  it("throws when identity.json is malformed", async () => {
    const dir = join(tmpDir, "bad-json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "identity.json"), "{ not valid json }}}");

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow("Failed to parse identity.json");
  });

  it("reads identity.yaml when present", async () => {
    const dir = join(tmpDir, "yaml-agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "identity.yaml"),
      [
        "name: yaml-test",
        "displayName: YAML Test",
        "role: eng",
        "emoji: wrench",
        "description: A YAML test agent",
        "volumeSize: 30",
        "plugins:",
        "  - openclaw-linear",
        "skills:",
        "  - coding",
        "templateVars:",
        "  - OWNER_NAME",
      ].join("\n")
    );
    writeFileSync(join(dir, "SOUL.md"), "# YAML Soul");

    const result = await fetchIdentity(dir, cacheDir);

    expect(result.manifest.name).toBe("yaml-test");
    expect(result.manifest.plugins).toEqual(["openclaw-linear"]);
    expect(result.files["SOUL.md"]).toBe("# YAML Soul");
    expect(result.files["identity.yaml"]).toBeUndefined();
  });

  it("prefers identity.yaml over identity.json", async () => {
    const dir = join(tmpDir, "both-formats");
    mkdirSync(dir, { recursive: true });
    // Write both files with different names to verify YAML wins
    writeFileSync(join(dir, "identity.yaml"), [
      "name: from-yaml",
      "displayName: YAML Agent",
      "role: eng",
      "emoji: wrench",
      "description: From YAML",
      "volumeSize: 30",
      "skills: [coding]",
      "templateVars: [OWNER_NAME]",
    ].join("\n"));
    writeFileSync(join(dir, "identity.json"), JSON.stringify(validManifest({ name: "from-json" })));

    const result = await fetchIdentity(dir, cacheDir);

    expect(result.manifest.name).toBe("from-yaml");
  });

  it("throws when required fields are missing", async () => {
    const dir = join(tmpDir, "missing-fields");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "identity.json"), JSON.stringify({ name: "only-name" }));

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow("missing required fields");
  });

  it("includes field names in validation error", async () => {
    const dir = join(tmpDir, "missing-specific");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "identity.json"),
      JSON.stringify({ name: "test", displayName: "Test" })
    );

    try {
      await fetchIdentity(dir, cacheDir);
      expect.fail("Should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("role");
      expect(msg).toContain("volumeSize");
      expect(msg).toContain("skills");
    }
  });

  it("throws when directory does not exist", async () => {
    await expect(
      fetchIdentity(join(tmpDir, "nonexistent"), cacheDir)
    ).rejects.toThrow("Identity directory not found");
  });

  it("throws when volumeSize is not a number", async () => {
    const dir = createIdentityDir(tmpDir, "bad-type", validManifest({ volumeSize: "big" }));

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow('"volumeSize" must be a number');
  });

  it("throws when skills is not an array", async () => {
    const dir = createIdentityDir(tmpDir, "bad-skills", validManifest({ skills: "not-array" }));

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow('"skills" must be an array');
  });
});
