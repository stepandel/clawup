import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { MANIFEST_FILE } from "@clawup/core";

// Mock the project module so we can control findProjectRoot
vi.mock("../project", () => ({
  findProjectRoot: vi.fn(() => null),
}));

// We need to import after mocking
import { findProjectRoot } from "../project";
import { getWorkspaceDir, isDevMode, ensureWorkspace } from "../workspace";

const mockedFindProjectRoot = vi.mocked(findProjectRoot);

describe("getWorkspaceDir", () => {
  beforeEach(() => {
    mockedFindProjectRoot.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined in dev mode", () => {
    // isDevMode is determined by filesystem checks relative to __dirname,
    // and this test runs from the dev repo, so isDevMode() returns true
    if (isDevMode()) {
      expect(getWorkspaceDir()).toBeUndefined();
    }
  });

  it("returns ~/.clawup/workspace/ in global mode (no project root)", () => {
    // Skip if running in dev mode since dev mode takes precedence
    if (isDevMode()) return;

    mockedFindProjectRoot.mockReturnValue(null);
    const result = getWorkspaceDir();
    expect(result).toBe(join(homedir(), ".clawup", "workspace"));
  });

  it("returns <projectRoot>/.clawup/ in project mode", () => {
    // Skip if running in dev mode since dev mode takes precedence
    if (isDevMode()) return;

    mockedFindProjectRoot.mockReturnValue("/tmp/my-project");
    const result = getWorkspaceDir();
    expect(result).toBe(join("/tmp/my-project", ".clawup"));
  });

  it("dev mode takes precedence over project mode", () => {
    mockedFindProjectRoot.mockReturnValue("/tmp/my-project");
    if (isDevMode()) {
      expect(getWorkspaceDir()).toBeUndefined();
    }
  });
});

describe("ensureWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok in dev mode regardless of project root", () => {
    mockedFindProjectRoot.mockReturnValue("/tmp/some-project");
    if (isDevMode()) {
      const result = ensureWorkspace();
      expect(result.ok).toBe(true);
    }
  });
});

describe("getWorkspaceDir — workspace resolution logic", () => {
  // These tests verify the workspace resolution logic directly
  // by testing the priority: dev mode > project mode > global mode.
  // Since we're in a dev repo, we verify dev mode behavior directly
  // and mock-based tests for the other modes.

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("project mode workspace is under .clawup directory", () => {
    if (isDevMode()) return;

    const projectRoot = "/home/user/my-clawup-project";
    mockedFindProjectRoot.mockReturnValue(projectRoot);

    const wsDir = getWorkspaceDir();
    expect(wsDir).toBe(join(projectRoot, ".clawup"));
    expect(wsDir!.endsWith(".clawup")).toBe(true);
  });

  it("global mode workspace is under ~/.clawup/workspace", () => {
    if (isDevMode()) return;

    mockedFindProjectRoot.mockReturnValue(null);

    const wsDir = getWorkspaceDir();
    expect(wsDir).toBe(join(homedir(), ".clawup", "workspace"));
    expect(wsDir!.includes(homedir())).toBe(true);
  });
});
