/**
 * Workspace management for installed CLI mode.
 *
 * Dev mode:  repo root has Pulumi.yaml + node_modules/@pulumi → use repo directly
 * Installed: bundle infra to ~/.agent-army/workspace/, npm-install Pulumi SDK there
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const WORKSPACE_DIR = path.join(os.homedir(), ".agent-army", "workspace");
const VERSION_FILE = ".cli-version";

/**
 * Read the CLI package version from cli/package.json at build time.
 * At runtime this resolves to cli/dist/lib/workspace.js → ../../package.json.
 */
function cliVersion(): string {
  const pkgPath = path.join(__dirname, "..", "..", "package.json");
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string;
  } catch {
    return "unknown";
  }
}

/**
 * Resolve the bundled infra directory shipped inside the npm package.
 * From cli/dist/lib/ → ../../infra/
 */
function getBundledInfraDir(): string {
  return path.join(__dirname, "..", "..", "infra");
}

/**
 * Returns true when running from the development repo (not from an npm install).
 * Detected by the presence of Pulumi.yaml AND node_modules/@pulumi at the repo root.
 */
export function isDevMode(): boolean {
  // cli/dist/lib/ → 3 levels up → repo root
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return (
    fs.existsSync(path.join(repoRoot, "Pulumi.yaml")) &&
    fs.existsSync(path.join(repoRoot, "node_modules", "@pulumi"))
  );
}

/**
 * Returns the workspace directory for installed mode, or undefined in dev mode.
 */
export function getWorkspaceDir(): string | undefined {
  if (isDevMode()) return undefined;
  return WORKSPACE_DIR;
}

/**
 * Ensure the workspace is set up (copy bundled infra, install deps).
 * No-op in dev mode.
 */
export function ensureWorkspace(): { ok: boolean; error?: string } {
  if (isDevMode()) return { ok: true };

  const bundled = getBundledInfraDir();
  if (!fs.existsSync(bundled)) {
    return {
      ok: false,
      error: `Bundled infrastructure not found at ${bundled}. The CLI package may be corrupt — try reinstalling.`,
    };
  }

  const version = cliVersion();
  const versionFile = path.join(WORKSPACE_DIR, VERSION_FILE);
  const currentVersion = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, "utf-8").trim()
    : null;

  if (currentVersion === version) {
    // Already up-to-date
    return { ok: true };
  }

  // Create workspace directory
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  // Preserve user state files across re-sync
  const preservePatterns = ["Pulumi.*.yaml", "agent-army.yaml"];
  const preserved = new Map<string, Buffer>();
  for (const pattern of preservePatterns) {
    // Simple glob: Pulumi.*.yaml
    const files = fs.readdirSync(WORKSPACE_DIR).filter((f) => {
      if (pattern === "agent-army.yaml") return f === "agent-army.yaml";
      // Match Pulumi.<stack>.yaml but not Pulumi.yaml itself
      return f.startsWith("Pulumi.") && f.endsWith(".yaml") && f !== "Pulumi.yaml";
    });
    for (const f of files) {
      preserved.set(f, fs.readFileSync(path.join(WORKSPACE_DIR, f)));
    }
  }

  // Sync bundled infra → workspace (overwrite everything except preserved files)
  copyDirSync(bundled, WORKSPACE_DIR);

  // Restore preserved files
  for (const [name, content] of preserved) {
    fs.writeFileSync(path.join(WORKSPACE_DIR, name), content);
  }

  // Install Pulumi SDK deps
  try {
    execSync("npm install --production", {
      cwd: WORKSPACE_DIR,
      stdio: "pipe",
      timeout: 300_000, // 5 minutes
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to install Pulumi SDK dependencies in workspace:\n${msg}`,
    };
  }

  // Write version marker only after successful install
  fs.writeFileSync(versionFile, version, "utf-8");

  return { ok: true };
}

/**
 * Recursively copy a directory, overwriting existing files.
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
