/**
 * Pulumi CLI wrappers
 */

import { capture, stream } from "./exec";
import type { VoidResult } from "@clawup/core";

/**
 * Get the current Pulumi stack name
 */
export function currentStack(cwd?: string): string | null {
  const result = capture("pulumi", ["stack", "--show-name"], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Select a Pulumi stack (create if it doesn't exist).
 * Returns { ok, error } so callers can display the error message.
 */
export function selectOrCreateStack(stackName: string, cwd?: string): VoidResult {
  const select = capture("pulumi", ["stack", "select", stackName], cwd);
  if (select.exitCode === 0) return { ok: true };

  const init = capture("pulumi", ["stack", "init", stackName], cwd);
  if (init.exitCode === 0) return { ok: true };

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
