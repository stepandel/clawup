import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MANIFEST_FILE } from "@clawup/core";
import { findProjectRoot, isProjectMode, getProjectRoot } from "../project";

describe("findProjectRoot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "project-root-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the directory containing clawup.yaml", () => {
    writeFileSync(join(tmpDir, MANIFEST_FILE), "stack: test\n");

    const result = findProjectRoot(tmpDir);

    expect(result).toBe(tmpDir);
  });

  it("walks up to find clawup.yaml in a parent directory", () => {
    writeFileSync(join(tmpDir, MANIFEST_FILE), "stack: test\n");
    const nested = join(tmpDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });

    const result = findProjectRoot(nested);

    expect(result).toBe(tmpDir);
  });

  it("returns null when no clawup.yaml exists", () => {
    // tmpDir has no manifest file
    const result = findProjectRoot(tmpDir);

    expect(result).toBeNull();
  });

  it("returns the nearest ancestor with clawup.yaml", () => {
    // Create manifest at two levels
    writeFileSync(join(tmpDir, MANIFEST_FILE), "stack: outer\n");
    const inner = join(tmpDir, "sub");
    mkdirSync(inner);
    writeFileSync(join(inner, MANIFEST_FILE), "stack: inner\n");
    const deep = join(inner, "deep");
    mkdirSync(deep);

    const result = findProjectRoot(deep);

    expect(result).toBe(inner);
  });

  it("uses process.cwd() as default start directory", () => {
    // Just verify it returns a string or null (no crash)
    const result = findProjectRoot();

    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("isProjectMode", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "project-mode-test-"));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when inside a project directory", () => {
    writeFileSync(join(tmpDir, MANIFEST_FILE), "stack: test\n");
    process.chdir(tmpDir);

    expect(isProjectMode()).toBe(true);
  });

  it("returns false when not inside a project directory", () => {
    // tmpDir has no manifest
    process.chdir(tmpDir);

    expect(isProjectMode()).toBe(false);
  });
});

describe("getProjectRoot", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "get-project-root-test-"));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the project root when inside a project", () => {
    writeFileSync(join(tmpDir, MANIFEST_FILE), "stack: test\n");
    const sub = join(tmpDir, "subdir");
    mkdirSync(sub);
    process.chdir(sub);

    expect(getProjectRoot()).toBe(tmpDir);
  });

  it("throws when not inside a project", () => {
    process.chdir(tmpDir);

    expect(() => getProjectRoot()).toThrow(
      `${MANIFEST_FILE} not found in current directory or any parent`
    );
  });
});
