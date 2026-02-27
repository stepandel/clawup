/**
 * E2E Redeploy Tests
 *
 * Tests redeploy flows:
 * A) Redeploy an existing stack (in-place update)
 * B) Redeploy with no existing stack (fresh deploy fallback)
 *
 * Requires: Docker running, Pulumi installed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { dockerContainerName } from "@clawup/core";

// ---------------------------------------------------------------------------
// State shared across tests
// ---------------------------------------------------------------------------

let tempDir: string;
let stackName: string;
let containerName: string;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@clack/prompts", () => ({
  spinner: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  }),
  log: {
    info: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: () => false,
}));

vi.mock("../lib/project", () => ({
  findProjectRoot: vi.fn(() => tempDir),
  getProjectRoot: vi.fn(() => {
    if (!tempDir) throw new Error("tempDir not set");
    return tempDir;
  }),
  isProjectMode: vi.fn(() => !!tempDir),
}));

// Mock workspace for project mode (Pulumi runs from workspace dir)
vi.mock("../lib/workspace", () => ({
  getWorkspaceDir: vi.fn(() => {
    if (!tempDir) throw new Error("tempDir not set before getWorkspaceDir");
    return path.join(tempDir, ".clawup");
  }),
  ensureWorkspace: vi.fn(() => ({ ok: true })),
  isDevMode: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createTestAdapter } from "./helpers/test-adapter";
import {
  createTestProject,
  forceCleanup,
  isContainerRunning,
  containerExists,
  ProcessExitError,
} from "./helpers/test-project";
import { setupCommand } from "../commands/setup";
import { deployTool } from "../tools/deploy";
import { redeployTool } from "../tools/redeploy";
import { validateTool } from "../tools/validate";
import { destroyTool } from "../tools/destroy";

// =========================================================================
// Suite A: Redeploy existing stack
// =========================================================================

const E2E_ENV_KEYS = [
  "PULUMI_CONFIG_PASSPHRASE",
  "PULUMI_SKIP_UPDATE_CHECK",
  "PULUMI_BACKEND_URL",
  "CLAWUP_LOCAL_BASE_PORT",
] as const;
let savedEnv: Record<string, string | undefined> = {};

describe("Redeploy existing stack (in-place update)", () => {
  beforeAll(() => {
    savedEnv = Object.fromEntries(
      E2E_ENV_KEYS.map((key) => [key, process.env[key]]),
    );

    stackName = `e2e-rd-${Date.now()}`;
    containerName = dockerContainerName(`${stackName}-local`, "agent-e2e-test");
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-rd-"));

    // Set up workspace directory for project mode
    const workspaceDir = path.join(tempDir, ".clawup");
    fs.mkdirSync(workspaceDir, { recursive: true });
    
    // Copy Pulumi.yaml to workspace
    const repoRoot = path.resolve(__dirname, "../../..");
    fs.copyFileSync(path.join(repoRoot, "Pulumi.yaml"), path.join(workspaceDir, "Pulumi.yaml"));
    
    // Create packages/pulumi/dist structure to match Pulumi.yaml main path
    const workspaceDistDir = path.join(workspaceDir, "packages/pulumi/dist");
    fs.mkdirSync(workspaceDistDir, { recursive: true });
    
    const repoDistDir = path.join(repoRoot, "packages/pulumi/dist");
    fs.cpSync(repoDistDir, workspaceDistDir, { recursive: true });
    
    // Symlink node_modules for @pulumi/pulumi and other dependencies
    fs.symlinkSync(
      path.join(repoRoot, "node_modules"),
      path.join(workspaceDir, "node_modules"),
      "dir"
    );

    process.env.PULUMI_CONFIG_PASSPHRASE = "test";
    process.env.PULUMI_SKIP_UPDATE_CHECK = "true";
    process.env.PULUMI_BACKEND_URL = `file://${path.join(tempDir, ".pulumi-backend")}`;
    fs.mkdirSync(path.join(tempDir, ".pulumi-backend"), { recursive: true });
    process.env.CLAWUP_LOCAL_BASE_PORT = "28789";

    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new ProcessExitError(typeof code === "number" ? code : 1);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    forceCleanup(stackName, tempDir);

    try {
      const manifestInCwd = path.join(process.cwd(), "clawup.yaml");
      if (fs.existsSync(manifestInCwd)) fs.unlinkSync(manifestInCwd);
    } catch { /* ignore */ }

    for (const key of E2E_ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("setup + deploy creates initial stack", async () => {
    createTestProject({ stackName, dir: tempDir });
    await setupCommand({ envFile: path.join(tempDir, ".env") });

    const { adapter, dispose } = createTestAdapter();
    try {
      await deployTool(adapter, { yes: true, local: true });
      expect(isContainerRunning(containerName)).toBe(true);
    } finally {
      dispose();
    }
  }, 360_000);

  it("redeploy updates the existing stack in-place", async () => {
    const { adapter, ui, dispose } = createTestAdapter();

    try {
      await redeployTool(adapter, { yes: true, local: true });

      // Assert: uses in-place update mode
      expect(ui.hasNote("Redeploy Summary")).toBe(true);
      const summaryContent = ui.getNoteContent("Redeploy Summary")!;
      expect(summaryContent).toContain("In-place update");
      expect(summaryContent).toContain(stackName);
      expect(summaryContent).toContain("TestBot");

      // Assert: pulumi up --refresh was used (step log)
      expect(ui.hasLog("step", "--refresh")).toBe(true);

      // Assert: container still running
      expect(isContainerRunning(containerName)).toBe(true);

      // Assert: success + outro
      expect(ui.hasLog("success", "Redeploy complete!")).toBe(true);
      expect(ui.outros.some((m) => m.includes("validate"))).toBe(true);
    } finally {
      dispose();
    }
  }, 300_000);

  it("validate passes after redeploy", async () => {
    await new Promise((r) => setTimeout(r, 3_000));

    const { adapter, ui, dispose } = createTestAdapter();

    try {
      await validateTool(adapter, { local: true, timeout: "60" });
    } catch (err) {
      if (!(err instanceof ProcessExitError)) throw err;
    } finally {
      dispose();
    }

    // Assert: validation ran with correct agent count
    const summary = ui.getValidationSummary();
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(1);

    // Assert: "Container running" check PASSED
    const containerCheck = ui.getCheckResult("Container running");
    expect(containerCheck).not.toBeNull();
    expect(containerCheck!.passed).toBe(true);

    // Assert: all expected checks ran
    const workspaceCheck = ui.getCheckResult("Workspace files");
    expect(workspaceCheck).not.toBeNull();

    const claudeCheck = ui.getCheckResult("Claude Code CLI");
    expect(claudeCheck).not.toBeNull();
  }, 120_000);

  it("cleanup: destroy removes containers", async () => {
    const { adapter, ui, dispose } = createTestAdapter();
    try {
      await destroyTool(adapter, { yes: true, local: true });
      expect(containerExists(containerName)).toBe(false);
      expect(ui.hasLog("success", "has been destroyed")).toBe(true);
    } finally {
      dispose();
    }
  }, 120_000);
});

// =========================================================================
// Suite B: Redeploy with no existing stack (fresh deploy fallback)
// =========================================================================

describe("Redeploy with no existing stack (fresh deploy fallback)", () => {
  beforeAll(() => {
    savedEnv = Object.fromEntries(
      E2E_ENV_KEYS.map((key) => [key, process.env[key]]),
    );

    stackName = `e2e-rd2-${Date.now()}`;
    containerName = dockerContainerName(`${stackName}-local`, "agent-e2e-test");
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-rd2-"));

    // Set up workspace directory for project mode
    const workspaceDir = path.join(tempDir, ".clawup");
    fs.mkdirSync(workspaceDir, { recursive: true });
    
    // Copy Pulumi.yaml to workspace
    const repoRoot = path.resolve(__dirname, "../../..");
    fs.copyFileSync(path.join(repoRoot, "Pulumi.yaml"), path.join(workspaceDir, "Pulumi.yaml"));
    
    // Create packages/pulumi/dist structure to match Pulumi.yaml main path
    const workspaceDistDir = path.join(workspaceDir, "packages/pulumi/dist");
    fs.mkdirSync(workspaceDistDir, { recursive: true });
    
    const repoDistDir = path.join(repoRoot, "packages/pulumi/dist");
    fs.cpSync(repoDistDir, workspaceDistDir, { recursive: true });
    
    // Symlink node_modules for @pulumi/pulumi and other dependencies
    fs.symlinkSync(
      path.join(repoRoot, "node_modules"),
      path.join(workspaceDir, "node_modules"),
      "dir"
    );

    process.env.PULUMI_CONFIG_PASSPHRASE = "test";
    process.env.PULUMI_SKIP_UPDATE_CHECK = "true";
    process.env.PULUMI_BACKEND_URL = `file://${path.join(tempDir, ".pulumi-backend")}`;
    fs.mkdirSync(path.join(tempDir, ".pulumi-backend"), { recursive: true });
    process.env.CLAWUP_LOCAL_BASE_PORT = "28789";

    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new ProcessExitError(typeof code === "number" ? code : 1);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    forceCleanup(stackName, tempDir);

    try {
      const manifestInCwd = path.join(process.cwd(), "clawup.yaml");
      if (fs.existsSync(manifestInCwd)) fs.unlinkSync(manifestInCwd);
    } catch { /* ignore */ }

    for (const key of E2E_ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("setup creates the base stack (but no deploy)", async () => {
    createTestProject({ stackName, dir: tempDir });
    await setupCommand({ envFile: path.join(tempDir, ".env") });
  }, 60_000);

  it("redeploy falls back to fresh deploy", async () => {
    const { adapter, ui, dispose } = createTestAdapter();

    try {
      await redeployTool(adapter, { yes: true, local: true });

      // Assert: warns about missing -local stack and falls back
      expect(ui.hasLog("warn", "does not exist")).toBe(true);

      // Assert: summary shows fresh deploy mode
      expect(ui.hasNote("Redeploy Summary")).toBe(true);
      const summaryContent = ui.getNoteContent("Redeploy Summary")!;
      expect(summaryContent).toContain("Fresh deploy");
      expect(summaryContent).toContain("TestBot");

      // Assert: container created and running
      expect(containerExists(containerName)).toBe(true);
      expect(isContainerRunning(containerName)).toBe(true);

      // Assert: success + outro
      expect(ui.hasLog("success", "Redeploy complete!")).toBe(true);
      expect(ui.outros.some((m) => m.includes("validate"))).toBe(true);
    } finally {
      dispose();
    }
  }, 300_000);

  it("cleanup: destroy removes containers", async () => {
    const { adapter, ui, dispose } = createTestAdapter();
    try {
      await destroyTool(adapter, { yes: true, local: true });
      expect(containerExists(containerName)).toBe(false);
      expect(ui.hasLog("success", "has been destroyed")).toBe(true);
    } finally {
      dispose();
    }
  }, 120_000);
});
