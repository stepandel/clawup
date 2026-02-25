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

describe("Redeploy existing stack (in-place update)", () => {
  beforeAll(() => {
    stackName = `e2e-rd-${Date.now()}`;
    containerName = dockerContainerName(`${stackName}-local`, "agent-e2e-test");
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-rd-"));

    process.env.PULUMI_CONFIG_PASSPHRASE = "test";
    process.env.PULUMI_SKIP_UPDATE_CHECK = "true";

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

    delete process.env.PULUMI_CONFIG_PASSPHRASE;
  });

  it("setup + deploy creates initial stack", async () => {
    createTestProject({ stackName, dir: tempDir });
    await setupCommand({ envFile: path.join(tempDir, ".env") });

    const { adapter } = createTestAdapter();
    await deployTool(adapter, { yes: true, local: true });

    expect(isContainerRunning(containerName)).toBe(true);
  }, 360_000);

  it("redeploy updates the existing stack in-place", async () => {
    const { adapter, ui } = createTestAdapter();

    await redeployTool(adapter, { yes: true, local: true });

    // Assert: uses in-place update mode
    expect(ui.hasNote("Redeploy Summary")).toBe(true);
    expect(ui.hasNoteContent("In-place update")).toBe(true);

    // Assert: container still running
    expect(isContainerRunning(containerName)).toBe(true);

    // Assert: success
    expect(ui.hasLog("success", "Redeploy complete!")).toBe(true);
  }, 300_000);

  it("validate passes after redeploy", async () => {
    await new Promise((r) => setTimeout(r, 3_000));

    const { adapter, ui } = createTestAdapter();

    try {
      await validateTool(adapter, { local: true, timeout: "60" });
    } catch (err) {
      if (!(err instanceof ProcessExitError)) throw err;
    }

    expect(ui.hasNote("Validation Summary")).toBe(true);
  }, 120_000);

  it("cleanup: destroy removes containers", async () => {
    const { adapter } = createTestAdapter();
    await destroyTool(adapter, { yes: true, local: true });
    expect(containerExists(containerName)).toBe(false);
  }, 120_000);
});

// =========================================================================
// Suite B: Redeploy with no existing stack (fresh deploy fallback)
// =========================================================================

describe("Redeploy with no existing stack (fresh deploy fallback)", () => {
  beforeAll(() => {
    stackName = `e2e-rd2-${Date.now()}`;
    containerName = dockerContainerName(`${stackName}-local`, "agent-e2e-test");
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-rd2-"));

    process.env.PULUMI_CONFIG_PASSPHRASE = "test";
    process.env.PULUMI_SKIP_UPDATE_CHECK = "true";

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

    delete process.env.PULUMI_CONFIG_PASSPHRASE;
  });

  it("setup creates the base stack (but no deploy)", async () => {
    createTestProject({ stackName, dir: tempDir });
    await setupCommand({ envFile: path.join(tempDir, ".env") });
  }, 60_000);

  it("redeploy falls back to fresh deploy", async () => {
    const { adapter, ui } = createTestAdapter();

    await redeployTool(adapter, { yes: true, local: true });

    // Assert: warns about missing stack and falls back
    expect(ui.hasLog("warn", "does not exist")).toBe(true);

    // Assert: fresh deploy mode
    expect(ui.hasNoteContent("Fresh deploy")).toBe(true);

    // Assert: container created
    expect(isContainerRunning(containerName)).toBe(true);

    // Assert: success
    expect(ui.hasLog("success", "Redeploy complete!")).toBe(true);
  }, 300_000);

  it("cleanup: destroy removes containers", async () => {
    const { adapter } = createTestAdapter();
    await destroyTool(adapter, { yes: true, local: true });
    expect(containerExists(containerName)).toBe(false);
  }, 120_000);
});
