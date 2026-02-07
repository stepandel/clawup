/**
 * Pulumi CLI wrappers
 */

import { capture, stream } from "./exec";

/**
 * Get the current Pulumi stack name
 */
export function currentStack(): string | null {
  const result = capture("pulumi", ["stack", "--show-name"]);
  return result.exitCode === 0 ? result.stdout : null;
}

/**
 * Select a Pulumi stack (create if it doesn't exist)
 */
export function selectOrCreateStack(stackName: string): boolean {
  const select = capture("pulumi", ["stack", "select", stackName]);
  if (select.exitCode === 0) return true;

  const init = capture("pulumi", ["stack", "init", stackName]);
  return init.exitCode === 0;
}

/**
 * Set a Pulumi config value
 */
export function setConfig(key: string, value: string, secret: boolean = false): boolean {
  const args = ["config", "set", key, value];
  if (secret) args.push("--secret");
  const result = capture("pulumi", args);
  return result.exitCode === 0;
}

/**
 * Get a Pulumi config value
 */
export function getConfig(key: string): string | null {
  const result = capture("pulumi", ["config", "get", key]);
  return result.exitCode === 0 ? result.stdout : null;
}

/**
 * Get stack outputs as JSON
 */
export function getStackOutputs(showSecrets: boolean = false): Record<string, unknown> | null {
  const args = ["stack", "output", "--json"];
  if (showSecrets) args.push("--show-secrets");
  const result = capture("pulumi", args);
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
export function pulumiUp(): Promise<number> {
  return stream("pulumi", ["up", "--yes"]);
}

/**
 * Run pulumi destroy with streaming output
 */
export function pulumiDestroy(): Promise<number> {
  return stream("pulumi", ["destroy", "--yes"]);
}

/**
 * Run pulumi preview with streaming output
 */
export function pulumiPreview(): Promise<number> {
  return stream("pulumi", ["preview"]);
}
