/**
 * Vendor binary management
 *
 * Resolves vendored CLI binaries (Pulumi, AWS CLI) installed to cli/vendor/
 * by the postinstall script. Falls back to system PATH if not found.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * Get the vendor directory path.
 * At runtime this resolves from cli/dist/lib/vendor.js → ../../vendor/
 */
export function getVendorDir(): string {
  return path.join(__dirname, "..", "..", "vendor");
}

/**
 * Get the vendor bin directory for the current platform.
 * Structure: vendor/pulumi/, vendor/aws-cli/
 */
function getVendorBinDir(tool: string): string {
  return path.join(getVendorDir(), tool);
}

/**
 * Map of commands to their vendor subdirectory and binary name.
 */
const VENDOR_COMMANDS: Record<string, { dir: string; bin: string }> = {
  pulumi: { dir: "pulumi", bin: process.platform === "win32" ? "pulumi.exe" : "pulumi" },
  aws: { dir: "aws-cli", bin: process.platform === "win32" ? "aws.exe" : "aws" },
};

/**
 * Resolve a command to its vendored binary path if available.
 * Returns the full path to the vendored binary, or null if not found.
 */
export function resolveVendoredBinary(command: string): string | null {
  const entry = VENDOR_COMMANDS[command];
  if (!entry) return null;

  const binPath = path.join(getVendorBinDir(entry.dir), entry.bin);
  if (fs.existsSync(binPath)) {
    return binPath;
  }

  return null;
}

/**
 * Resolve a command, checking vendor directory first, then system PATH.
 * Returns the resolved command string (full path for vendor, original for system).
 */
export function resolveCommand(command: string): string {
  const vendored = resolveVendoredBinary(command);
  if (vendored) return vendored;
  return command;
}

/**
 * Check if a vendored binary exists for the given command.
 */
export function isVendored(command: string): boolean {
  return resolveVendoredBinary(command) !== null;
}

/**
 * Check if a command exists, checking vendor directory first, then system PATH.
 */
export function commandExistsWithVendor(command: string): boolean {
  // Check vendor first
  if (isVendored(command)) return true;

  // Fall back to system PATH
  const bin = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(bin, [command], { shell: false, stdio: "ignore" });
  return result.status === 0;
}

/**
 * Get the vendor PATH prefix for adding to child process environment.
 * This allows vendored binaries to be found by child processes.
 */
export function getVendorPATH(): string {
  const dirs: string[] = [];
  for (const entry of Object.values(VENDOR_COMMANDS)) {
    const dir = getVendorBinDir(entry.dir);
    if (fs.existsSync(dir)) {
      dirs.push(dir);
    }
  }
  return dirs.join(path.delimiter);
}
