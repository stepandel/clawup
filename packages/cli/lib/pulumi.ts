/**
 * Pulumi CLI wrappers
 */

import { createHash } from "crypto";
import { capture, stream } from "./exec";
import type { VoidResult } from "@clawup/core";

/** Pulumi config key used to detect stack collisions across projects. */
export const FINGERPRINT_KEY = "clawup:projectFingerprint";

/**
 * Compute a deterministic fingerprint for a project directory.
 * SHA-256 of the absolute path, truncated to 16 hex chars.
 */
export function projectFingerprint(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
}

/**
 * Stamp the project fingerprint into Pulumi config for the current stack.
 */
function stampFingerprint(projectRoot: string, cwd?: string): void {
  setConfig(FINGERPRINT_KEY, projectFingerprint(projectRoot), false, cwd);
}

/**
 * Verify the stored fingerprint matches the current project.
 * Returns ok:true if the fingerprint matches or is absent (legacy stack, which gets backfilled).
 */
function verifyFingerprint(projectRoot: string, cwd?: string): VoidResult {
  const stored = getConfig(FINGERPRINT_KEY, cwd);
  if (!stored) {
    // Legacy stack — backfill and allow
    stampFingerprint(projectRoot, cwd);
    return { ok: true };
  }
  const expected = projectFingerprint(projectRoot);
  if (stored !== expected) {
    return {
      ok: false,
      error:
        'Stack name collision detected! This Pulumi stack belongs to a different clawup project.\n' +
        'Change the "stackName" in your clawup.yaml to a unique value, then run "clawup init" again.',
    };
  }
  return { ok: true };
}

/**
 * Build the fully-qualified Pulumi stack name.
 * When an organization is provided, returns "org/stackName";
 * otherwise returns just "stackName".
 */
export function qualifiedStackName(stackName: string, organization?: string): string {
  return organization ? `${organization}/${stackName}` : stackName;
}

/**
 * Get the current Pulumi stack name
 */
export function currentStack(cwd?: string): string | null {
  const result = capture("pulumi", ["stack", "--show-name"], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Select a Pulumi stack (create if it doesn't exist).
 * When projectRoot is provided, verifies/stamps a fingerprint to detect
 * stack name collisions across different clawup projects.
 * Returns { ok, error } so callers can display the error message.
 */
export function selectOrCreateStack(stackName: string, cwd?: string, projectRoot?: string): VoidResult {
  const select = capture("pulumi", ["stack", "select", stackName], cwd);
  if (select.exitCode === 0) {
    if (projectRoot) {
      const fp = verifyFingerprint(projectRoot, cwd);
      if (!fp.ok) return fp;
    }
    return { ok: true };
  }

  const init = capture("pulumi", ["stack", "init", stackName], cwd);
  if (init.exitCode === 0) {
    if (projectRoot) stampFingerprint(projectRoot, cwd);
    return { ok: true };
  }

  return { ok: false, error: init.stderr || select.stderr };
}

/**
 * Set a Pulumi config value
 */
export function setConfig(key: string, value: string, secret: boolean = false, cwd?: string): boolean {
  const args = ["config", "set", key, value];
  if (secret) args.push("--secret");
  const result = capture("pulumi", args, cwd);
  return result.exitCode === 0;
}

/**
 * Get a Pulumi config value
 */
export function getConfig(key: string, cwd?: string): string | null {
  const result = capture("pulumi", ["config", "get", key], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Get stack outputs as JSON
 */
export function getStackOutputs(showSecrets: boolean = false, cwd?: string): Record<string, unknown> | null {
  const args = ["stack", "output", "--json"];
  if (showSecrets) args.push("--show-secrets");
  const result = capture("pulumi", args, cwd);
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Run pulumi up with streaming output
 */
export function pulumiUp(cwd?: string): Promise<number> {
  return stream("pulumi", ["up", "--yes"], cwd);
}

/**
 * Run pulumi destroy with streaming output
 */
export function pulumiDestroy(cwd?: string): Promise<number> {
  return stream("pulumi", ["destroy", "--yes"], cwd);
}

/**
 * Run pulumi preview with streaming output
 */
export function pulumiPreview(cwd?: string): Promise<number> {
  return stream("pulumi", ["preview"], cwd);
}
