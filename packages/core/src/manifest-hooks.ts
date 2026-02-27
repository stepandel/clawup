/**
 * Manifest hook execution engine for plugin provisioning and secret resolution.
 */

import { spawn } from "child_process";
import type { PluginManifest } from "./plugin-registry";

/** Result of a successful resolve hook execution */
export interface ResolveHookSuccess {
  ok: true;
  value: string;
}

/** Result of a successful lifecycle hook execution */
export interface HookSuccess {
  ok: true;
}

/** Result of a failed hook execution */
export interface HookError {
  ok: false;
  error: string;
}

export type ResolveHookResult = ResolveHookSuccess | HookError;
export type HookResult = HookSuccess | HookError;

/**
 * Execute a resolve hook script and capture stdout as the resolved secret value.
 *
 * @param script - Shell script to execute
 * @param env - Environment variables (includes secrets like $LINEAR_API_KEY)
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns The resolved value (trimmed stdout) or an error
 */
export function runResolveHook(params: {
  script: string;
  env: Record<string, string>;
  timeoutMs?: number;
}): Promise<ResolveHookResult> {
  const { script, env, timeoutMs = 30000 } = params;

  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      resolve({
        ok: false,
        error: `Resolve hook timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";

    const child = spawn("/bin/sh", ["-c", script], {
      env: { ...process.env, ...env },
      signal: controller.signal,
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") {
        // Timeout already handled
        return;
      }
      resolve({
        ok: false,
        error: `Failed to spawn process: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        resolve({
          ok: false,
          error: `Resolve hook exited with code ${code}. stderr: ${stderr.trim()}`,
        });
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({
          ok: false,
          error: "Resolve hook produced empty output (resolved value cannot be empty)",
        });
        return;
      }

      resolve({ ok: true, value: trimmed });
    });
  });
}

/**
 * Execute a lifecycle hook (postProvision or preStart).
 * Streams stdout/stderr to logger and returns success/failure.
 *
 * @param script - Shell script to execute
 * @param env - Environment variables (optional)
 * @param timeoutMs - Timeout in milliseconds (default: 120000 for postProvision, 60000 for preStart)
 * @param label - Label for logging (e.g., "postProvision", "preStart")
 * @returns Success or error result
 */
export function runLifecycleHook(params: {
  script: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  label: string;
}): Promise<HookResult> {
  const { script, env = {}, timeoutMs = 120000, label } = params;

  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      resolve({
        ok: false,
        error: `${label} hook timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let stderr = "";

    const child = spawn("/bin/sh", ["-c", script], {
      env: { ...process.env, ...env },
      signal: controller.signal,
    });

    // Stream stdout/stderr to console for visibility
    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[${label}] ${chunk.toString()}`);
    });

    child.stderr.on("data", (chunk) => {
      const msg = chunk.toString();
      stderr += msg;
      process.stderr.write(`[${label}] ${msg}`);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") {
        // Timeout already handled
        return;
      }
      resolve({
        ok: false,
        error: `Failed to spawn ${label} process: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        resolve({
          ok: false,
          error: `${label} hook exited with code ${code}. stderr: ${stderr.trim()}`,
        });
        return;
      }

      resolve({ ok: true });
    });
  });
}

/**
 * Resolve all autoResolvable secrets for a plugin manifest.
 * Runs each resolve hook in sequence and collects the results.
 *
 * @param manifest - Plugin manifest with hooks and secrets
 * @param env - Environment variables (must include any secrets needed by resolve hooks)
 * @returns Map of envVar -> resolved value, or an error
 */
export async function resolvePluginSecrets(params: {
  manifest: PluginManifest;
  env: Record<string, string>;
}): Promise<{ ok: true; values: Record<string, string> } | { ok: false; error: string }> {
  const { manifest, env } = params;

  if (!manifest.hooks?.resolve) {
    return { ok: true, values: {} };
  }

  const resolvedValues: Record<string, string> = {};

  for (const [secretKey, script] of Object.entries(manifest.hooks.resolve)) {
    const secret = manifest.secrets[secretKey];
    if (!secret) {
      return {
        ok: false,
        error: `Resolve hook key "${secretKey}" does not correspond to any secret (validation should have caught this)`,
      };
    }

    const result = await runResolveHook({ script, env });
    if (!result.ok) {
      return {
        ok: false,
        error: `Failed to resolve secret "${secretKey}" (${secret.envVar}): ${result.error}`,
      };
    }

    resolvedValues[secret.envVar] = result.value;
  }

  return { ok: true, values: resolvedValues };
}

/** Result of a successful onboard hook execution */
export interface OnboardHookSuccess {
  ok: true;
  /** Follow-up instructions displayed to the user (captured stdout) */
  instructions: string;
}

export type OnboardHookResult = OnboardHookSuccess | HookError;

/**
 * Execute an onboard hook script.
 * Captures stdout as follow-up instructions, streams stderr for progress.
 *
 * @param script - Shell script to execute
 * @param env - Environment variables (includes user-provided inputs + existing secrets)
 * @param timeoutMs - Timeout in milliseconds (default: 120000)
 * @returns Follow-up instructions (stdout) or an error
 */
export function runOnboardHook(params: {
  script: string;
  env: Record<string, string>;
  timeoutMs?: number;
}): Promise<OnboardHookResult> {
  const { script, env, timeoutMs = 120000 } = params;

  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      resolve({
        ok: false,
        error: `Onboard hook timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";

    const child = spawn("/bin/sh", ["-c", script], {
      env: { ...process.env, ...env },
      signal: controller.signal,
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      const msg = chunk.toString();
      stderr += msg;
      process.stderr.write(`[onboard] ${msg}`);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") {
        return;
      }
      resolve({
        ok: false,
        error: `Failed to spawn onboard process: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        resolve({
          ok: false,
          error: `Onboard hook exited with code ${code}. stderr: ${stderr.trim()}`,
        });
        return;
      }

      resolve({ ok: true, instructions: stdout.trim() });
    });
  });
}
