/**
 * E2E Error Cases — Fast tests for error scenarios (no Docker needed).
 *
 * Tests that tools fail gracefully when preconditions aren't met.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tempDir: string;
let projectRootOverride: string | null = null;

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
  findProjectRoot: vi.fn(() => projectRootOverride),
  getProjectRoot: vi.fn(() => {
    if (!projectRootOverride) throw new Error("clawup.yaml not found");
    return projectRootOverride;
  }),
  isProjectMode: vi.fn(() => !!projectRootOverride),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createTestAdapter, TestCancelError } from "./helpers/test-adapter";
import { ProcessExitError } from "./helpers/test-project";
import { deployTool } from "../tools/deploy";
import { destroyTool } from "../tools/destroy";
import { validateTool } from "../tools/validate";
import { initCommand } from "../commands/init";
import { setupCommand } from "../commands/setup";

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-err-"));

  vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
    throw new ProcessExitError(typeof code === "number" ? code : 1);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  projectRootOverride = null;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// =========================================================================
// Missing manifest errors
// =========================================================================

describe("deploy without manifest", () => {
  it("exits with error when no clawup.yaml exists", async () => {
    projectRootOverride = null;

    const { adapter, ui, dispose } = createTestAdapter();
    try {
      await expect(deployTool(adapter, { yes: true })).rejects.toThrow(ProcessExitError);
      expect(ui.hasLog("error", "clawup.yaml")).toBe(true);
    } finally {
      dispose();
    }
  }, 30_000);
});

describe("destroy without manifest", () => {
  it("exits with error when no clawup.yaml exists", async () => {
    projectRootOverride = null;

    const { adapter, ui, dispose } = createTestAdapter();
    try {
      await expect(destroyTool(adapter, { yes: true })).rejects.toThrow(ProcessExitError);
      expect(ui.hasLog("error", "clawup.yaml")).toBe(true);
    } finally {
      dispose();
    }
  }, 30_000);
});

describe("validate without manifest", () => {
  it("exits with error when no clawup.yaml exists", async () => {
    projectRootOverride = null;

    const { adapter, ui, dispose } = createTestAdapter();
    try {
      await expect(validateTool(adapter, {})).rejects.toThrow(ProcessExitError);
      expect(ui.hasLog("error", "clawup.yaml")).toBe(true);
    } finally {
      dispose();
    }
  }, 30_000);
});

// =========================================================================
// Cancellation
// =========================================================================

describe("deploy cancelled by user", () => {
  it("throws TestCancelError when user declines", async () => {
    // Set up a valid manifest
    projectRootOverride = tempDir;
    const YAML = await import("yaml");
    fs.writeFileSync(
      path.join(tempDir, "clawup.yaml"),
      YAML.stringify({
        stackName: "e2e-cancel-test",
        provider: "aws",
        region: "us-east-1",
        instanceType: "t3.medium",
        ownerName: "tester",
        agents: [
          {
            name: "agent-test",
            displayName: "TestBot",
            role: "tester",
            identity: path.resolve(__dirname, "helpers/fixtures/identity"),
            volumeSize: 10,
          },
        ],
      }),
      "utf-8",
    );

    // User answers "no" to confirmation
    const { adapter, dispose } = createTestAdapter({ confirm: [false] });
    try {
      await expect(deployTool(adapter, {})).rejects.toThrow(TestCancelError);
    } finally {
      dispose();
    }
  }, 30_000);
});

describe("destroy cancelled by user", () => {
  it("throws TestCancelError when user declines", async () => {
    projectRootOverride = tempDir;
    const YAML = await import("yaml");
    fs.writeFileSync(
      path.join(tempDir, "clawup.yaml"),
      YAML.stringify({
        stackName: "e2e-cancel-test",
        provider: "aws",
        region: "us-east-1",
        instanceType: "t3.medium",
        ownerName: "tester",
        agents: [
          {
            name: "agent-test",
            displayName: "TestBot",
            role: "tester",
            identity: path.resolve(__dirname, "helpers/fixtures/identity"),
            volumeSize: 10,
          },
        ],
      }),
      "utf-8",
    );

    // Destroy requires: text (type stack name), then confirm (yes/no)
    // Set confirm to false → cancel
    const { adapter, dispose } = createTestAdapter({
      text: ["e2e-cancel-test"],
      confirm: [false],
    });
    try {
      await expect(destroyTool(adapter, {})).rejects.toThrow(TestCancelError);
    } finally {
      dispose();
    }
  }, 30_000);
});

// =========================================================================
// Setup errors
// =========================================================================

describe("setup with missing .env", () => {
  it("exits with error when .env file doesn't exist", async () => {
    projectRootOverride = tempDir;
    const YAML = await import("yaml");
    fs.writeFileSync(
      path.join(tempDir, "clawup.yaml"),
      YAML.stringify({
        stackName: "e2e-err-test",
        provider: "local",
        region: "local",
        instanceType: "local",
        ownerName: "tester",
        agents: [
          {
            name: "agent-test",
            displayName: "TestBot",
            role: "tester",
            identity: path.resolve(__dirname, "helpers/fixtures/identity"),
            volumeSize: 10,
          },
        ],
      }),
      "utf-8",
    );

    // No .env file — setup should fail
    await expect(setupCommand()).rejects.toThrow(ProcessExitError);
  }, 30_000);
});

// =========================================================================
// Init with invalid manifest
// =========================================================================

describe("init repair with invalid manifest", () => {
  it("exits with error on invalid YAML", async () => {
    projectRootOverride = tempDir;

    // Write invalid clawup.yaml (missing required fields)
    fs.writeFileSync(
      path.join(tempDir, "clawup.yaml"),
      "stackName: test\n",
      "utf-8",
    );

    await expect(initCommand()).rejects.toThrow(ProcessExitError);
  }, 30_000);
});
