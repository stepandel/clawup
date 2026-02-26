/**
 * E2E Plugin Test: deploy → validate → destroy with Slack + Linear plugins
 *
 * Tests the full CLI lifecycle for plugin configuration using local Docker containers.
 * Verifies that openclaw.json contains correct plugin config structure and that
 * validation checks run for plugin secrets.
 *
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

// Mock workspace to use dev mode (Pulumi runs from repo root)
vi.mock("../lib/workspace", () => ({
  getWorkspaceDir: vi.fn(() => path.join(tempDir, ".clawup")),
  ensureWorkspace: vi.fn(() => ({ ok: true })),
  isDevMode: vi.fn(() => false),
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

describe("Plugin Lifecycle: deploy → validate → destroy (Slack + Linear)", () => {
  beforeAll(() => {
    // Generate unique stack name
    stackName = `e2e-plugin-${Date.now()}`;
    containerName = dockerContainerName(`${stackName}-local`, "agent-e2e-plugin-test");

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawup-e2e-plugin-"));

    // Set up workspace directory for project mode
    const workspaceDir = path.join(tempDir, ".clawup");
    fs.mkdirSync(workspaceDir, { recursive: true });
    
    // Copy Pulumi.yaml to workspace
    const repoRoot = path.resolve(__dirname, "../../..");
    fs.copyFileSync(path.join(repoRoot, "Pulumi.yaml"), path.join(workspaceDir, "Pulumi.yaml"));
    
    // Create packages/pulumi/dist structure to match Pulumi.yaml main path
    const workspaceDistDir = path.join(workspaceDir, "packages/pulumi/dist");
    fs.mkdirSync(workspaceDistDir, { recursive: true });
    
    // Copy dist contents
    const repoDistDir = path.join(repoRoot, "packages/pulumi/dist");
    fs.cpSync(repoDistDir, workspaceDistDir, { recursive: true });
    
    // Symlink node_modules for @pulumi/pulumi and other dependencies
    fs.symlinkSync(
      path.join(repoRoot, "node_modules"),
      path.join(workspaceDir, "node_modules"),
      "dir"
    );

    // Set env vars for Pulumi
    process.env.PULUMI_CONFIG_PASSPHRASE = "test";
    process.env.PULUMI_SKIP_UPDATE_CHECK = "true";
    process.env.PULUMI_BACKEND_URL = "file://~";
    process.env.CLAWUP_LOCAL_BASE_PORT = "28789";

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
  // Test 1: init creates manifest with plugin identity
  // -------------------------------------------------------------------------

  it("init creates manifest with plugin identity", async () => {
    // Create a basic project pointing at the plugin identity fixture
    createTestProject({
      stackName,
      dir: tempDir,
      identityDir: PLUGIN_IDENTITY_DIR,
      agentName: "agent-e2e-plugin-test",
      displayName: "PluginBot",
      role: "plugintester",
      extraEnvLines: [
        "PLUGINTESTER_SLACK_BOT_TOKEN=xoxb-fake-bot-token-for-e2e",
        "PLUGINTESTER_SLACK_APP_TOKEN=xapp-fake-app-token-for-e2e",
        "PLUGINTESTER_LINEAR_API_KEY=lin_api_fake_key_for_e2e",
        "PLUGINTESTER_LINEAR_WEBHOOK_SECRET=fake-webhook-secret-for-e2e",
        "PLUGINTESTER_LINEAR_USER_UUID=fake-uuid-for-e2e",
      ],
    });

    // Run init — it finds the existing manifest and enters repair mode
    await initCommand();

    // Assert: clawup.yaml still exists and is valid YAML
    const manifestPath = path.join(tempDir, "clawup.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const YAML = await import("yaml");
    const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.stackName).toBe(stackName);
    expect(manifest.agents).toHaveLength(1);
    expect(manifest.agents[0].name).toBe("agent-e2e-plugin-test");
    expect(manifest.agents[0].displayName).toBe("PluginBot");
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 2: setup validates secrets and provisions Pulumi with plugin config
  // -------------------------------------------------------------------------

  it("setup validates plugin secrets and creates Pulumi stack", async () => {
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
  // Test 3: deploy --local creates Docker container with plugin config
  // -------------------------------------------------------------------------

  it("deploy --local creates Docker container with plugin config", async () => {
    const { adapter, ui, dispose } = createTestAdapter();

    try {
      await deployTool(adapter, { yes: true, local: true });

      // Assert: container exists and is running
      expect(containerExists(containerName)).toBe(true);
      expect(isContainerRunning(containerName)).toBe(true);

      // Assert: UI shows deployment summary
      expect(ui.hasNote("Deployment Summary")).toBe(true);
      const summaryContent = ui.getNoteContent("Deployment Summary")!;
      expect(summaryContent).toContain(stackName);
      expect(summaryContent).toContain("Local Docker");
      expect(summaryContent).toContain("PluginBot");

      // Assert: UI shows success message
      expect(ui.hasLog("success", "Deployment complete!")).toBe(true);

      // Read openclaw.json from the container
      const configResult = execSync(
        `docker exec ${containerName} cat /home/ubuntu/.openclaw/openclaw.json`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const config = JSON.parse(configResult);

      // Assert: Slack channel config exists (channels-based plugin)
      expect(config.channels).toBeDefined();
      expect(config.channels.slack).toBeDefined();
      expect("botToken" in config.channels.slack).toBe(true);
      expect("appToken" in config.channels.slack).toBe(true);
      expect("enabled" in config.channels.slack).toBe(true);

      // Assert: Linear plugin config exists (plugins.entries-based plugin)
      expect(config.plugins).toBeDefined();
      expect(config.plugins.entries).toBeDefined();
      expect(config.plugins.entries["openclaw-linear"]).toBeDefined();
      expect(config.plugins.entries["openclaw-linear"].config).toBeDefined();

      // Assert: Internal keys are NOT in the deployed config
      // agentId is marked as internal in the plugin manifest
      const linearConfig = config.plugins.entries["openclaw-linear"].config;
      expect(linearConfig.agentId).toBeUndefined();
    } finally {
      dispose();
    }
  }, 300_000);

  // -------------------------------------------------------------------------
  // Test 4: validate --local runs plugin-specific checks
  // -------------------------------------------------------------------------

  it("validate --local runs plugin secret checks", async () => {
    // Wait briefly for container to stabilize
    await new Promise((r) => setTimeout(r, 3_000));

    const { adapter, ui, dispose } = createTestAdapter();

    // Validate — plugin secret checks should run (may pass or fail based on config)
    try {
      await validateTool(adapter, { local: true, timeout: "60" });
    } catch (err) {
      // Expected — validation exits 1 when auth checks fail with dummy key
      if (!(err instanceof ProcessExitError)) throw err;
    } finally {
      dispose();
    }

    // Assert: validation summary note was generated
    const summary = ui.getValidationSummary();
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(1);

    // Assert: agent header was logged
    expect(ui.hasLog("info", "PluginBot")).toBe(true);

    // Assert: "Container running" check PASSED
    const containerCheck = ui.getCheckResult("Container running");
    expect(containerCheck).not.toBeNull();
    expect(containerCheck!.passed).toBe(true);
    expect(containerCheck!.detail).toBe("running");

    // Assert: Plugin secret checks were executed for Slack
    const slackBotCheck = ui.getCheckResult("slack secret (SLACK_BOT_TOKEN)");
    expect(slackBotCheck).not.toBeNull();

    const slackAppCheck = ui.getCheckResult("slack secret (SLACK_APP_TOKEN)");
    expect(slackAppCheck).not.toBeNull();

    // Assert: Plugin secret checks were executed for Linear
    const linearApiCheck = ui.getCheckResult("openclaw-linear secret (LINEAR_API_KEY)");
    expect(linearApiCheck).not.toBeNull();

    const linearWebhookCheck = ui.getCheckResult("openclaw-linear secret (LINEAR_WEBHOOK_SECRET)");
    expect(linearWebhookCheck).not.toBeNull();

    // Assert: Overall validation reports failures (expected with dummy secrets/API key)
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

      // Assert: "Destruction Plan" note was shown
      expect(ui.hasNote("Destruction Plan")).toBe(true);
      const planContent = ui.getNoteContent("Destruction Plan")!;
      expect(planContent).toContain(stackName);
      expect(planContent).toContain("Local Docker");
      expect(planContent).toContain("Docker containers");
      expect(planContent).toContain("PluginBot");

      // Assert: success message with stack name
      expect(ui.hasLog("success", "has been destroyed")).toBe(true);

      // Assert: outro
      expect(ui.outros.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  }, 120_000);
});
