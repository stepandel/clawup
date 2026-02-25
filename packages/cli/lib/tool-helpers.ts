/**
 * Shared helpers for tool implementations (adapter-aware).
 *
 * These mirror the functions in pulumi.ts but accept an ExecAdapter
 * instead of using the global capture() directly.
 */

import type { ExecAdapter } from "../adapters";
import { FINGERPRINT_KEY, projectFingerprint } from "./pulumi";

/**
 * Get a Pulumi config value via ExecAdapter.
 */
export function getConfig(exec: ExecAdapter, key: string, cwd?: string): string | null {
  const result = exec.capture("pulumi", ["config", "get", key], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Set a Pulumi config value via ExecAdapter.
 */
export function setConfig(exec: ExecAdapter, key: string, value: string, cwd?: string, secret?: boolean): boolean {
  const args = ["config", "set", key, value];
  if (secret) args.push("--secret");
  const result = exec.capture("pulumi", args, cwd);
  return result.exitCode === 0;
}

/**
 * Get stack outputs as JSON via ExecAdapter.
 */
export function getStackOutputs(exec: ExecAdapter, showSecrets: boolean = false, cwd?: string): Record<string, unknown> | null {
  const args = ["stack", "output", "--json"];
  if (showSecrets) args.push("--show-secrets");
  const result = exec.capture("pulumi", args, cwd);
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Verify the current stack belongs to the given project.
 * Returns an error message on collision, null if OK.
 */
export function verifyStackOwnership(exec: ExecAdapter, projectRoot: string, cwd?: string): string | null {
  const stored = getConfig(exec, FINGERPRINT_KEY, cwd);
  if (!stored) {
    // Legacy stack — backfill and allow
    stampStackFingerprint(exec, projectRoot, cwd);
    return null;
  }
  const expected = projectFingerprint(projectRoot);
  if (stored !== expected) {
    return (
      'Stack name collision detected! This Pulumi stack belongs to a different clawup project.\n' +
      'Change the "stackName" in your clawup.yaml to a unique value, then run "clawup init" again.'
    );
  }
  return null;
}

/**
 * Stamp the project fingerprint into Pulumi config for the current stack.
 */
export function stampStackFingerprint(exec: ExecAdapter, projectRoot: string, cwd?: string): void {
  setConfig(exec, FINGERPRINT_KEY, projectFingerprint(projectRoot), cwd);
}
