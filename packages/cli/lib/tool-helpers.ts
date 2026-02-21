/**
 * Shared helpers for tool implementations (adapter-aware).
 *
 * These mirror the functions in pulumi.ts but accept an ExecAdapter
 * instead of using the global capture() directly.
 */

import type { ExecAdapter } from "../adapters";

/**
 * Get a Pulumi config value via ExecAdapter.
 */
export function getConfig(exec: ExecAdapter, key: string, cwd?: string): string | null {
  const result = exec.capture("pulumi", ["config", "get", key], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
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
