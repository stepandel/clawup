/**
 * Workspace management for installed CLI mode.
 *
 * Dev mode:  repo root has Pulumi.yaml + node_modules/@pulumi → use repo directly
 * Installed: bundle infra to ~/.clawup/workspace/, npm-install Pulumi SDK there
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import type { VoidResult } from "@clawup/core";
import { findProjectRoot } from "./project";

const GLOBAL_WORKSPACE_DIR = path.join(os.homedir(), ".clawup", "workspace");
const VERSION_FILE = ".cli-version";

/**
 * Resolve the CLI package root directory.
 * Works for both tsc output (dist/lib/workspace.js → ../../) and
 * esbuild bundle (dist/bin.js → ../).
 */
function getCliPackageRoot(): string {
  const oneUp = path.resolve(__dirname, "..");
  if (fs.existsSync(path.join(oneUp, "package.json"))) return oneUp;
  return path.resolve(__dirname, "..", "..");
}

/**
 * Read the CLI package version from cli/package.json.
 */
function cliVersion(): string {
  try {
    const pkgPath = path.join(getCliPackageRoot(), "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string;
  } catch {
    return "unknown";
  }
}

/**
 * Resolve the bundled infra directory shipped inside the npm package.
 */
function getBundledInfraDir(): string {
  return path.join(getCliPackageRoot(), "infra");
}

/**
 * Returns true when running from the development repo (not from an npm install).
 * Detected by the presence of Pulumi.yaml AND node_modules/@pulumi at the repo root.
 */
export function isDevMode(): boolean {
  const repoRoot = path.resolve(getCliPackageRoot(), "..");
  return (
    fs.existsSync(path.join(repoRoot, "Pulumi.yaml")) &&
    fs.existsSync(path.join(repoRoot, "node_modules", "@pulumi"))
  );
}

/**
 * Returns the workspace directory based on the current mode:
 * - Dev mode: undefined (use repo root directly)
 * - Project mode: <projectRoot>/.clawup/
 * - Global mode: ~/.clawup/workspace/
 */
export function getWorkspaceDir(): string | undefined {
  if (isDevMode()) return undefined;
  const projectRoot = findProjectRoot();
  if (projectRoot !== null) {
    return path.join(projectRoot, ".clawup");
  }
  return GLOBAL_WORKSPACE_DIR;
}

/**
 * Ensure the workspace is set up (copy bundled infra, install deps).
 * No-op in dev mode.
 */
export function ensureWorkspace(): VoidResult {
  if (isDevMode()) return { ok: true };

  const workspaceDir = getWorkspaceDir()!;

  const bundled = getBundledInfraDir();
  if (!fs.existsSync(bundled)) {
    return {
      ok: false,
      error: `Bundled infrastructure not found at ${bundled}. The CLI package may be corrupt — try reinstalling.`,
    };
  }

  const version = cliVersion();
  const versionFile = path.join(workspaceDir, VERSION_FILE);
  const currentVersion = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, "utf-8").trim()
    : null;

  if (currentVersion === version) {
    // Already up-to-date
    return { ok: true };
  }

  // Create workspace directory
  fs.mkdirSync(workspaceDir, { recursive: true });

  // Preserve user state files across re-sync
  const preservePatterns = ["Pulumi.*.yaml", "clawup.yaml"];
  const preserved = new Map<string, Buffer>();
  for (const pattern of preservePatterns) {
    // Simple glob: Pulumi.*.yaml
    const files = fs.readdirSync(workspaceDir).filter((f) => {
      if (pattern === "clawup.yaml") return f === "clawup.yaml";
      // Match Pulumi.<stack>.yaml but not Pulumi.yaml itself
      return f.startsWith("Pulumi.") && f.endsWith(".yaml") && f !== "Pulumi.yaml";
    });
    for (const f of files) {
      preserved.set(f, fs.readFileSync(path.join(workspaceDir, f)));
    }
  }

  // Sync bundled infra → workspace (overwrite everything except preserved files)
  copyDirSync(bundled, workspaceDir);

  // Restore preserved files
  for (const [name, content] of preserved) {
    fs.writeFileSync(path.join(workspaceDir, name), content);
  }

  // Install Pulumi SDK deps
  try {
    execSync("npm install --production", {
      cwd: workspaceDir,
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

  // Re-copy @clawup/core after npm install, which prunes it since it's
  // not in package.json (it's a private workspace package, not on npm).
  const bundledCore = path.join(bundled, "node_modules", "@clawup", "core");
  if (fs.existsSync(bundledCore)) {
    const destCore = path.join(workspaceDir, "node_modules", "@clawup", "core");
    fs.mkdirSync(destCore, { recursive: true });
    copyDirSync(bundledCore, destCore);
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
