/**
 * Test project helpers for E2E tests.
 *
 * Provides utilities to create temporary test projects with clawup.yaml,
 * force-cleanup Docker containers and Pulumi stacks, and check container status.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import YAML from "yaml";

// ============================================================================
// ProcessExitError — thrown by mocked process.exit()
// ============================================================================

export class ProcessExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.name = "ProcessExitError";
    this.code = code;
  }
}

// ============================================================================
// Test project creation
// ============================================================================

const FIXTURE_IDENTITY_DIR = path.resolve(
  __dirname,
  "fixtures",
  "identity",
);

interface CreateTestProjectOptions {
  /** Stack name for this test project */
  stackName: string;
  /** Directory to create the project in */
  dir: string;
  /** Custom ANTHROPIC_API_KEY (defaults to dummy) */
  anthropicApiKey?: string;
  /** Custom identity fixture directory (defaults to fixtures/identity) */
  identityDir?: string;
  /** Custom agent name (defaults to "agent-e2e-test") */
  agentName?: string;
  /** Custom display name (defaults to "TestBot") */
  displayName?: string;
  /** Custom role (defaults to "tester") */
  role?: string;
  /** Additional .env content lines (e.g., plugin secrets) */
  extraEnvLines?: string[];
  /** Override default model (e.g., "openai/gpt-4o") */
  model?: string;
  /** Model provider key (e.g., "openai") — defaults to "anthropic" */
  modelProvider?: string;
}

/**
 * Create a minimal test project directory with clawup.yaml and .env.
 */
export function createTestProject(options: CreateTestProjectOptions): void {
  const { stackName, dir, anthropicApiKey, identityDir, agentName, displayName, role, extraEnvLines, model, modelProvider } = options;
  const apiKey = anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? "sk-ant-fake-key-for-e2e";
  const identity = identityDir ?? FIXTURE_IDENTITY_DIR;

  fs.mkdirSync(dir, { recursive: true });

  // Write clawup.yaml
  const manifest: Record<string, unknown> = {
    stackName,
    provider: "local",
    region: "local",
    instanceType: "local",
    ownerName: "E2E Tester",
    timezone: "UTC",
    workingHours: "24/7",
    ...(model ? { defaultModel: model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    templateVars: {
      OWNER_NAME: "E2E Tester",
    },
    agents: [
      {
        name: agentName ?? "agent-e2e-test",
        displayName: displayName ?? "TestBot",
        role: role ?? "tester",
        identity,
        volumeSize: 10,
      },
    ],
  };
  fs.writeFileSync(
    path.join(dir, "clawup.yaml"),
    YAML.stringify(manifest),
    "utf-8",
  );

  // Write .env
  const envLines = [`ANTHROPIC_API_KEY=${apiKey}`];
  if (extraEnvLines) {
    envLines.push(...extraEnvLines);
  }
  fs.writeFileSync(
    path.join(dir, ".env"),
    envLines.join("\n") + "\n",
    "utf-8",
  );

  // Write .gitignore
  fs.writeFileSync(
    path.join(dir, ".gitignore"),
    ".clawup/\n.env\n",
    "utf-8",
  );
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Force-cleanup Docker containers, Pulumi stacks, and temp directory.
 * Safe to call even if resources don't exist.
 */
export function forceCleanup(stackName: string, projectDir: string): void {
  // 1. Force-remove Docker containers matching the stack name pattern
  try {
    const psResult = execSync(
      `docker ps -a --format '{{.Names}}' | grep "^clawup-${stackName}" || true`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const containers = psResult
      .trim()
      .split("\n")
      .filter((n) => n.length > 0);
    for (const name of containers) {
      try {
        execSync(`docker rm -f ${name}`, { stdio: "pipe" });
      } catch {
        // Ignore — container may already be gone
      }
    }
  } catch {
    // Ignore — Docker may not be running
  }

  // 2. Remove Pulumi stacks
  // We need to determine the workspace dir. In dev mode, cwd is undefined (repo root).
  // The E2E tests run from the project dir via chdir. Pulumi stacks are created in the
  // repo root's Pulumi workspace (since isDevMode() is true).
  for (const suffix of [`${stackName}-local`, stackName]) {
    try {
      execSync(`pulumi stack rm ${suffix} --yes --force`, {
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Ignore — stack may not exist
    }
  }

  // 3. Remove temp directory
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

// ============================================================================
// Docker container helpers
// ============================================================================

/**
 * Check if a Docker container is running.
 */
export function isContainerRunning(name: string): boolean {
  try {
    const result = execSync(
      `docker inspect -f '{{.State.Running}}' ${name}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return result.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Check if a Docker container exists (running or stopped).
 */
export function containerExists(name: string): boolean {
  try {
    execSync(`docker inspect ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a container to be running, polling every 2 seconds.
 */
export async function waitForContainerReady(
  name: string,
  timeoutMs: number = 60_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isContainerRunning(name)) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

// ============================================================================
// Temp directory helpers
// ============================================================================

/**
 * Create a unique temporary directory for a test.
 */
export function createTempDir(prefix: string = "clawup-e2e"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}
