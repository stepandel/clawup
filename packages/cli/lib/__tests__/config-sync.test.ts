import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MANIFEST_FILE } from "@clawup/core";

// Mock the project module
vi.mock("../project", () => ({
  findProjectRoot: vi.fn(() => null),
}));

import { findProjectRoot } from "../project";
import { syncManifestToProject, saveManifest, configsDir } from "../config";

const mockedFindProjectRoot = vi.mocked(findProjectRoot);

describe("syncManifestToProject", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "config-sync-test-"));
    mockedFindProjectRoot.mockReturnValue(null);
    // Isolate HOME so configsDir() doesn't touch real ~/.clawup/configs/
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("copies from project root in project mode", () => {
    const projectRoot = join(tmpDir, "project");
    mkdirSync(projectRoot);
    const clawupDir = join(projectRoot, ".clawup");
    mkdirSync(clawupDir);

    // Write a manifest at project root
    const manifestContent = "stack: my-project-stack\nregion: us-east-1\n";
    writeFileSync(join(projectRoot, MANIFEST_FILE), manifestContent);

    // Set up project mode
    mockedFindProjectRoot.mockReturnValue(projectRoot);

    // Sync manifest to the .clawup/ workspace
    syncManifestToProject("some-config", clawupDir);

    // Verify the manifest was copied from project root
    const copied = readFileSync(join(clawupDir, MANIFEST_FILE), "utf-8");
    expect(copied).toBe(manifestContent);
  });

  it("copies from configs dir in global mode", () => {
    const destDir = join(tmpDir, "workspace");
    mkdirSync(destDir);

    // Create a config in the global configs dir
    const configDir = configsDir();
    mkdirSync(configDir, { recursive: true });
    const manifestContent = "stack: global-stack\nregion: eu-west-1\n";
    writeFileSync(join(configDir, "test-config.yaml"), manifestContent);

    mockedFindProjectRoot.mockReturnValue(null);

    // Sync manifest in global mode
    syncManifestToProject("test-config", destDir);

    const copied = readFileSync(join(destDir, MANIFEST_FILE), "utf-8");
    expect(copied).toBe(manifestContent);
  });

  it("uses projectDir as destination in both modes", () => {
    const projectRoot = join(tmpDir, "project");
    mkdirSync(projectRoot);
    const customDest = join(tmpDir, "custom-dest");
    mkdirSync(customDest);

    const manifestContent = "stack: test-stack\n";
    writeFileSync(join(projectRoot, MANIFEST_FILE), manifestContent);

    mockedFindProjectRoot.mockReturnValue(projectRoot);

    syncManifestToProject("ignored-in-project-mode", customDest);

    expect(existsSync(join(customDest, MANIFEST_FILE))).toBe(true);
    const copied = readFileSync(join(customDest, MANIFEST_FILE), "utf-8");
    expect(copied).toBe(manifestContent);
  });
});
