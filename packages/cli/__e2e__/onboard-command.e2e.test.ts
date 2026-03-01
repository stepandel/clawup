/**
 * E2E tests for standalone `clawup onboard` command.
 *
 * Tests the onboard command bootstrapping (manifest loading, identity fetching,
 * plugin map building, env/secret resolution) and hook execution without Pulumi.
 *
 * Uses the test-linear plugin fixture which has an echo-based onboard hook.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// State shared across tests
// ---------------------------------------------------------------------------

let tempDir: string;

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

// Track p.text calls for onboard input prompting
const textCalls: string[] = [];

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
  text: vi.fn(async (opts: { message: string }) => {
    textCalls.push(opts.message);
    // Return a fake config token when prompted for onboard input
    return "tlct-fake-config-token-for-e2e";
  }),
}));

// Mock findProjectRoot to point at temp dir
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

import {
  createTestProject,
  ProcessExitError,
} from "./helpers/test-project";
import { onboardCommand } from "../commands/onboard";
import * as p from "@clack/prompts";
import { findProjectRoot } from "../lib/project";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_IDENTITY_DIR = path.resolve(
  __dirname,
  "helpers",
  "fixtures",
  "plugin-identity",
);

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

describe("Standalone onboard command", () => {
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-onboard-cmd-"));

    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new ProcessExitError(typeof code === "number" ? code : 1);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  // -------------------------------------------------------------------------
  // Test 1: onboard runs hook with input from env var
  // -------------------------------------------------------------------------

  it("onboard runs hook with input from env var", async () => {
    textCalls.length = 0;
    vi.mocked(p.log.info).mockClear();

    createTestProject({
      stackName: "e2e-onboard-cmd-env",
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-onboard-cmd",
      displayName: "OnboardBot",
      role: "onboardtester",
      extraEnvLines: [
        "ONBOARDTESTER_SLACK_BOT_TOKEN=xoxb-fake-bot-token-for-e2e",
        "ONBOARDTESTER_SLACK_APP_TOKEN=xapp-fake-app-token-for-e2e",
        "ONBOARDTESTER_LINEAR_API_KEY=lin_api_fake_key_for_e2e",
        "ONBOARDTESTER_LINEAR_WEBHOOK_SECRET=fake-webhook-secret-for-e2e",
        // Provide config token via env — no interactive prompt needed
        "ONBOARDTESTER_TEST_LINEAR_CONFIG_TOKEN=tlct-from-env-var",
      ],
    });

    await onboardCommand({ envFile: path.join(tempDir, ".env") });

    // p.text was NOT called for config token (resolved from env)
    expect(textCalls.filter((msg) => msg.includes("config token"))).toHaveLength(0);

    // p.log.info was called with hook description
    expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
      expect.stringContaining("Set up test Linear webhook integration"),
    );
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 2: onboard prompts interactively when input not in env
  // -------------------------------------------------------------------------

  it("onboard prompts interactively when input not in env", async () => {
    textCalls.length = 0;
    vi.mocked(p.log.info).mockClear();

    createTestProject({
      stackName: "e2e-onboard-cmd-prompt",
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-onboard-cmd",
      displayName: "OnboardBot",
      role: "onboardtester",
      extraEnvLines: [
        "ONBOARDTESTER_SLACK_BOT_TOKEN=xoxb-fake-bot-token-for-e2e",
        "ONBOARDTESTER_SLACK_APP_TOKEN=xapp-fake-app-token-for-e2e",
        "ONBOARDTESTER_LINEAR_API_KEY=lin_api_fake_key_for_e2e",
        "ONBOARDTESTER_LINEAR_WEBHOOK_SECRET=fake-webhook-secret-for-e2e",
        // TEST_LINEAR_CONFIG_TOKEN intentionally omitted — prompts interactively
      ],
    });

    await onboardCommand({ envFile: path.join(tempDir, ".env") });

    // p.text WAS called for the onboard hook input (config token)
    expect(textCalls.some((msg) => msg.toLowerCase().includes("config token"))).toBe(true);

    // Hook still ran (description logged)
    expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
      expect.stringContaining("Set up test Linear webhook integration"),
    );
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 3: runOnce skips when all secrets present
  // -------------------------------------------------------------------------

  it("runOnce skips when all secrets present", async () => {
    textCalls.length = 0;
    vi.mocked(p.log.info).mockClear();

    // Use an isolated copy of the identity fixture to avoid mutating the shared fixture
    const identityDirForRunOnce = fs.mkdtempSync(path.join(tempDir, "identity-runonce-"));
    fs.cpSync(PLUGIN_IDENTITY_DIR, identityDirForRunOnce, { recursive: true });
    const manifestPath = path.join(identityDirForRunOnce, "plugins", "test-linear.yaml");
    const originalManifest = fs.readFileSync(manifestPath, "utf-8");
    fs.writeFileSync(manifestPath, originalManifest.replace("runOnce: false", "runOnce: true"), "utf-8");

    try {
      createTestProject({
        stackName: "e2e-onboard-cmd-runonce",
        dir: tempDir,
        identityDir: identityDirForRunOnce,
        agentName: "agent-e2e-onboard-cmd",
        displayName: "OnboardBot",
        role: "onboardtester",
        extraEnvLines: [
          "ONBOARDTESTER_SLACK_BOT_TOKEN=xoxb-fake-bot-token-for-e2e",
          "ONBOARDTESTER_SLACK_APP_TOKEN=xapp-fake-app-token-for-e2e",
          "ONBOARDTESTER_LINEAR_API_KEY=lin_api_fake_key_for_e2e",
          "ONBOARDTESTER_LINEAR_WEBHOOK_SECRET=fake-webhook-secret-for-e2e",
          "ONBOARDTESTER_LINEAR_USER_UUID=fake-uuid-already-configured",
        ],
      });

      await onboardCommand({ envFile: path.join(tempDir, ".env") });

      // p.text was NOT called (runOnce skipped the hook)
      expect(textCalls.filter((msg) => msg.includes("config token"))).toHaveLength(0);

      // p.log.info was called with "skipped (already configured)"
      expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
        expect.stringContaining("skipped (already configured)"),
      );
    } finally {
      fs.rmSync(identityDirForRunOnce, { recursive: true, force: true });
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 4: onboard exits with error when .env missing
  // -------------------------------------------------------------------------

  it("onboard exits with error when .env missing", async () => {
    createTestProject({
      stackName: "e2e-onboard-cmd-noenv",
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-onboard-cmd",
      displayName: "OnboardBot",
      role: "onboardtester",
    });

    // Delete the .env file
    const envPath = path.join(tempDir, ".env");
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);

    await expect(
      onboardCommand({ envFile: path.join(tempDir, ".env") }),
    ).rejects.toThrow(ProcessExitError);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 5: onboard exits with error when manifest missing
  // -------------------------------------------------------------------------

  it("onboard exits with error when manifest missing", async () => {
    vi.mocked(findProjectRoot).mockReturnValueOnce(null);

    await expect(onboardCommand()).rejects.toThrow(ProcessExitError);
  }, 30_000);
});
