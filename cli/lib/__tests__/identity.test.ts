import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fetchIdentity } from "../identity";

/** Helper to create a valid identity.json object */
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
    // identity.json itself should NOT be in files
    expect(result.files["identity.json"]).toBeUndefined();
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
      linearRouting: { add: ["eng"], remove: ["pm"] },
    });
    const dir = createIdentityDir(tmpDir, "optional", manifest);

    const result = await fetchIdentity(dir, cacheDir);

    expect(result.manifest.instanceType).toBe("t3.large");
    expect(result.manifest.linearRouting).toEqual({ add: ["eng"], remove: ["pm"] });
  });

  it("throws when identity.json is missing", async () => {
    const dir = join(tmpDir, "empty");
    mkdirSync(dir, { recursive: true });

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow("identity.json not found");
  });

  it("throws when identity.json is malformed JSON", async () => {
    const dir = join(tmpDir, "bad-json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "identity.json"), "{ not valid json }}}");

    await expect(fetchIdentity(dir, cacheDir)).rejects.toThrow("Failed to parse identity.json");
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
