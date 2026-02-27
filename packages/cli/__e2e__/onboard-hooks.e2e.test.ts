/**
 * E2E Onboard Hook Tests
 *
 * Tests the onboard hook lifecycle: first-time setup runs hook,
 * subsequent setup skips (runOnce), --skip-onboard bypasses.
 *
 * Uses the test-linear plugin fixture which has an echo-based onboard hook.
 *
 * Requires: Docker running, Pulumi installed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// State shared across tests
// ---------------------------------------------------------------------------

let tempDir: string;
let stackName: string;

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
    info: vi.fn((...args: unknown[]) => {
      // Capture log.info calls for assertion
      const msg = args.map(String).join(" ");
      if (msg.includes("Onboard") || msg.includes("onboard") || msg.includes("Follow-up")) {
        console.log(`[test-capture] ${msg}`);
      }
    }),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn((...args: unknown[]) => {
      console.log(`[test-capture-warn] ${args.map(String).join(" ")}`);
    }),
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

// Mock findProjectRoot/getProjectRoot to point at temp dir
vi.mock("../lib/project", () => ({
  findProjectRoot: vi.fn(() => tempDir),
  getProjectRoot: vi.fn(() => {
    if (!tempDir) throw new Error("tempDir not set");
    return tempDir;
  }),
  isProjectMode: vi.fn(() => !!tempDir),
}));

// Mock workspace for project mode
vi.mock("../lib/workspace", () => ({
  getWorkspaceDir: vi.fn(() => {
    if (!tempDir) throw new Error("tempDir not set before getWorkspaceDir");
    return path.join(tempDir, ".clawup");
  }),
  ensureWorkspace: vi.fn(() => ({ ok: true })),
  isDevMode: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  createTestProject,
  forceCleanup,
  ProcessExitError,
} from "./helpers/test-project";
import { setupCommand } from "../commands/setup";
import * as p from "@clack/prompts";

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

const E2E_ENV_KEYS = [
  "PULUMI_CONFIG_PASSPHRASE",
  "PULUMI_SKIP_UPDATE_CHECK",
  "PULUMI_BACKEND_URL",
  "CLAWUP_LOCAL_BASE_PORT",
] as const;
let savedEnv: Record<string, string | undefined> = {};

describe("Onboard Hooks: setup with onboard hook lifecycle", () => {
  beforeAll(() => {
    savedEnv = Object.fromEntries(
      E2E_ENV_KEYS.map((key) => [key, process.env[key]]),
    );

    stackName = `e2e-onboard-${Date.now()}`;
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-onboard-"));

    // Set up workspace directory for project mode
    const workspaceDir = path.join(tempDir, ".clawup");
    fs.mkdirSync(workspaceDir, { recursive: true });

    const repoRoot = path.resolve(__dirname, "../../..");
    fs.copyFileSync(path.join(repoRoot, "Pulumi.yaml"), path.join(workspaceDir, "Pulumi.yaml"));

    const workspaceDistDir = path.join(workspaceDir, "packages/pulumi/dist");
    fs.mkdirSync(workspaceDistDir, { recursive: true });
    fs.cpSync(path.join(repoRoot, "packages/pulumi/dist"), workspaceDistDir, { recursive: true });
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(workspaceDir, "node_modules"), "dir");

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

  // -------------------------------------------------------------------------
  // Test 1: setup runs onboard hook with input from env var
  // -------------------------------------------------------------------------

  it("setup runs onboard hook and captures instructions from stdout", async () => {
    textCalls.length = 0;

    createTestProject({
      stackName,
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-onboard-test",
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

    await setupCommand({ envFile: path.join(tempDir, ".env") });

    // Assert: p.text was NOT called for config token (resolved from env)
    expect(textCalls.filter((msg) => msg.includes("config token"))).toHaveLength(0);

    // Assert: p.log.info was called with onboard hook description
    expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
      expect.stringContaining("Set up test Linear webhook integration")
    );

    // Verify Pulumi stack was created
    const result = execSync("pulumi stack ls --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stacks = JSON.parse(result) as Array<{ name: string }>;
    expect(stacks.some((s) => s.name === stackName)).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 2: setup runs onboard hook with interactive input (via p.text mock)
  // -------------------------------------------------------------------------

  it("setup prompts for onboard input when not in env", async () => {
    textCalls.length = 0;

    try {
      execSync(`pulumi stack rm ${stackName}-local --yes --force 2>/dev/null`, {
        stdio: "pipe",
      });
    } catch { /* ignore */ }

    stackName = `e2e-onboard-prompt-${Date.now()}`;

    createTestProject({
      stackName,
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-onboard-test",
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

    await setupCommand({ envFile: path.join(tempDir, ".env") });

    // Assert: p.text WAS called for the onboard hook input (config token)
    expect(textCalls.some((msg) => msg.toLowerCase().includes("config token"))).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 3: setup with --skip-onboard bypasses onboard hooks
  // -------------------------------------------------------------------------

  it("setup --skip-onboard skips onboard hooks", async () => {
    textCalls.length = 0;

    // Clean up old stack
    try {
      execSync(`pulumi stack rm ${stackName}-local --yes --force 2>/dev/null`, {
        stdio: "pipe",
      });
    } catch { /* ignore */ }

    stackName = `e2e-onboard-skip-${Date.now()}`;

    createTestProject({
      stackName,
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-onboard-test",
      displayName: "OnboardBot",
      role: "onboardtester",
      extraEnvLines: [
        "ONBOARDTESTER_SLACK_BOT_TOKEN=xoxb-fake-bot-token-for-e2e",
        "ONBOARDTESTER_SLACK_APP_TOKEN=xapp-fake-app-token-for-e2e",
        "ONBOARDTESTER_LINEAR_API_KEY=lin_api_fake_key_for_e2e",
        "ONBOARDTESTER_LINEAR_WEBHOOK_SECRET=fake-webhook-secret-for-e2e",
        // No config token — but skip-onboard should prevent prompt
      ],
    });

    await setupCommand({
      envFile: path.join(tempDir, ".env"),
      skipOnboard: true,
    });

    // Assert: no p.text calls for config token
    expect(textCalls.filter((msg) => msg.includes("config token"))).toHaveLength(0);

    // Assert: p.log.warn was called with skip message
    expect(vi.mocked(p.log.warn)).toHaveBeenCalledWith(
      expect.stringContaining("Onboard hooks skipped")
    );
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 4: runOnce skips onboard when all secrets present
  // -------------------------------------------------------------------------

  it("runOnce skips onboard when all required secrets are present", async () => {
    textCalls.length = 0;
    vi.mocked(p.log.info).mockClear();

    // Clean up old stack
    try {
      execSync(`pulumi stack rm ${stackName}-local --yes --force 2>/dev/null`, {
        stdio: "pipe",
      });
    } catch { /* ignore */ }

    stackName = `e2e-onboard-runonce-${Date.now()}`;

    // Temporarily patch the test-linear manifest to set runOnce: true
    const manifestPath = path.join(PLUGIN_IDENTITY_DIR, "plugins", "test-linear.yaml");
    const originalManifest = fs.readFileSync(manifestPath, "utf-8");
    fs.writeFileSync(manifestPath, originalManifest.replace("runOnce: false", "runOnce: true"), "utf-8");

    try {
      createTestProject({
        stackName,
        dir: tempDir,
        identityDir: PLUGIN_IDENTITY_DIR,
        agentName: "agent-e2e-onboard-test",
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

      await setupCommand({ envFile: path.join(tempDir, ".env") });

      // Assert: no interactive prompt for onboard input (all secrets present → runOnce skips)
      expect(textCalls.filter((msg) => msg.includes("config token"))).toHaveLength(0);

      // Assert: p.log.info was called with "skipped (already configured)"
      expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
        expect.stringContaining("skipped (already configured)")
      );
    } finally {
      // Restore original manifest
      fs.writeFileSync(manifestPath, originalManifest, "utf-8");
    }
  }, 60_000);
});
