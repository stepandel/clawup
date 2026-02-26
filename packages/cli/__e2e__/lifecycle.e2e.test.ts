/**
 * E2E Lifecycle Test: init → setup → deploy → validate → destroy
 *
 * Tests the full CLI lifecycle using local Docker containers.
 * Requires: Docker running, Pulumi installed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { dockerContainerName } from "@clawup/core";

// ---------------------------------------------------------------------------
// State shared across tests
// ---------------------------------------------------------------------------

let tempDir: string;
let stackName: string;
let containerName: string;

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

// Mock @clack/prompts (used by init/setup commands directly)
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

// Mock findProjectRoot/getProjectRoot to point at temp dir
vi.mock("../lib/project", () => ({
  findProjectRoot: vi.fn(() => tempDir),
  getProjectRoot: vi.fn(() => {
    if (!tempDir) throw new Error("tempDir not set");
    return tempDir;
  }),
  isProjectMode: vi.fn(() => !!tempDir),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { createTestAdapter } from "./helpers/test-adapter";
import {
  createTestProject,
  forceCleanup,
  isContainerRunning,
  containerExists,
  ProcessExitError,
} from "./helpers/test-project";
import { initCommand } from "../commands/init";
import { setupCommand } from "../commands/setup";
import { deployTool } from "../tools/deploy";
import { validateTool } from "../tools/validate";
import { destroyTool } from "../tools/destroy";

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

describe("Lifecycle: init → setup → deploy → validate → destroy", () => {
  beforeAll(() => {
    // Generate unique stack name
    stackName = `e2e-${Date.now()}`;
    containerName = dockerContainerName(`${stackName}-local`, "agent-e2e-test");

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-"));

    // Set env vars for Pulumi
    process.env.PULUMI_CONFIG_PASSPHRASE = "test";
    process.env.PULUMI_SKIP_UPDATE_CHECK = "true";

    // Mock process.exit to throw instead of exiting
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new ProcessExitError(typeof code === "number" ? code : 1);
    });
  });

  afterAll(() => {
    // Restore process.exit
    vi.restoreAllMocks();

    // Force cleanup Docker containers and Pulumi stacks
    forceCleanup(stackName, tempDir);

    // Clean up clawup.yaml that syncManifestToProject writes to cwd
    try {
      const manifestInCwd = path.join(process.cwd(), "clawup.yaml");
      if (fs.existsSync(manifestInCwd)) {
        fs.unlinkSync(manifestInCwd);
      }
    } catch {
      // Ignore
    }

    // Clean up env vars
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
  });

  // -------------------------------------------------------------------------
  // Test 1: init creates manifest (repair mode)
  // -------------------------------------------------------------------------

  it("init creates manifest and .env.example", async () => {
    // Create a basic project for init to find and enter repair mode
    createTestProject({ stackName, dir: tempDir });

    // Run init — it finds the existing manifest and enters repair mode
    await initCommand();

    // Assert: .env.example was created/updated
    expect(fs.existsSync(path.join(tempDir, ".env.example"))).toBe(true);

    // Assert: clawup.yaml still exists and is valid YAML
    const manifestPath = path.join(tempDir, "clawup.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const YAML = await import("yaml");
    const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.stackName).toBe(stackName);
    expect(manifest.agents).toHaveLength(1);
    expect(manifest.agents[0].name).toBe("agent-e2e-test");

    // Assert: .gitignore was updated
    const gitignore = fs.readFileSync(path.join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".clawup/");
    expect(gitignore).toContain(".env");
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 2: setup validates secrets and provisions Pulumi
  // -------------------------------------------------------------------------

  it("setup validates secrets and creates Pulumi stack", async () => {
    // Run setup with the .env file
    await setupCommand({ envFile: path.join(tempDir, ".env") });

    // Verify Pulumi stack exists
    const result = execSync("pulumi stack ls --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stacks = JSON.parse(result) as Array<{ name: string }>;
    const found = stacks.some((s) => s.name === stackName);
    expect(found).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 3: deploy --local creates Docker containers
  // -------------------------------------------------------------------------

  it("deploy --local creates Docker container", async () => {
    const { adapter, ui, dispose } = createTestAdapter();

    try {
      await deployTool(adapter, { yes: true, local: true });

      // Assert: container exists and is running
      expect(containerExists(containerName)).toBe(true);
      expect(isContainerRunning(containerName)).toBe(true);

      // Assert: UI shows deployment summary with correct details
      expect(ui.hasNote("Deployment Summary")).toBe(true);
      const summaryContent = ui.getNoteContent("Deployment Summary")!;
      expect(summaryContent).toContain(stackName);
      expect(summaryContent).toContain("Local Docker");
      expect(summaryContent).toContain("TestBot");

      // Assert: UI shows success message
      expect(ui.hasLog("success", "Deployment complete!")).toBe(true);

      // Assert: outro with next steps
      expect(ui.outros.some((m) => m.includes("validate"))).toBe(true);
    } finally {
      dispose();
    }
  }, 300_000);

  // -------------------------------------------------------------------------
  // Test 4: validate --local checks container health
  // -------------------------------------------------------------------------

  it("validate --local checks container health", async () => {
    // Wait briefly for container to stabilize
    await new Promise((r) => setTimeout(r, 3_000));

    const { adapter, ui, dispose } = createTestAdapter();

    // Validate — some checks may fail (dummy API key) but infrastructure checks should pass.
    // The validate tool calls process.exit(1) if any agent fails.
    try {
      await validateTool(adapter, { local: true, timeout: "60" });
    } catch (err) {
      // Expected — validation exits 1 when auth checks fail with dummy key
      if (!(err instanceof ProcessExitError)) throw err;
    } finally {
      dispose();
    }

    // Assert: validation summary note was generated with correct agent count
    const summary = ui.getValidationSummary();
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(1);

    // Assert: agent header was logged
    expect(ui.hasLog("info", "TestBot")).toBe(true);

    // Parse individual check results from console output
    const checks = ui.getCheckResults();
    expect(checks.length).toBeGreaterThan(0);

    // Assert: "Container running" check PASSED — the core infrastructure check
    const containerCheck = ui.getCheckResult("Container running");
    expect(containerCheck).not.toBeNull();
    expect(containerCheck!.passed).toBe(true);
    expect(containerCheck!.detail).toBe("running");

    // Assert: "Workspace files" check ran
    // May fail in local Docker since cloud-init workspace injection may not complete
    // immediately. The important thing is that the check was executed.
    const workspaceCheck = ui.getCheckResult("Workspace files");
    expect(workspaceCheck).not.toBeNull();

    // Assert: Claude Code CLI check ran
    const claudeCheck = ui.getCheckResult("Claude Code CLI");
    expect(claudeCheck).not.toBeNull();

    // Assert: Claude Code auth check ran — expected to FAIL with dummy API key
    const authCheck = ui.getCheckResult("Claude Code auth");
    if (authCheck && !process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-api")) {
      expect(authCheck.passed).toBe(false);
    }

    // Assert: overall validation correctly reports the agent as failed
    // (auth checks fail with dummy key, so the agent fails)
    expect(summary!.failed).toBe(1);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test 5: destroy --local removes containers
  // -------------------------------------------------------------------------

  it("destroy --local removes Docker container", async () => {
    const { adapter, ui, dispose } = createTestAdapter();

    try {
      await destroyTool(adapter, { yes: true, local: true });

      // Assert: container no longer exists
      expect(containerExists(containerName)).toBe(false);
      expect(isContainerRunning(containerName)).toBe(false);

      // Assert: "Destruction Plan" note was shown with correct details
      expect(ui.hasNote("Destruction Plan")).toBe(true);
      const planContent = ui.getNoteContent("Destruction Plan")!;
      expect(planContent).toContain(stackName);
      expect(planContent).toContain("Local Docker");
      expect(planContent).toContain("Docker containers");
      expect(planContent).toContain("TestBot");

      // Assert: success message with stack name
      expect(ui.hasLog("success", "has been destroyed")).toBe(true);

      // Assert: outro
      expect(ui.outros.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  }, 120_000);
});
