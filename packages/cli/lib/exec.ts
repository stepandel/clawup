/**
 * Child process helpers for CLI commands
 */

import { execSync, spawn, type SpawnOptions } from "child_process";
import { trackChild } from "./process";
import { resolveCommand, commandExistsWithVendor } from "./vendor";

/** Result of a captured command execution */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command and capture output.
 * Resolves vendored binaries before falling back to system PATH.
 */
export function capture(command: string, args: string[] = [], cwd?: string): ExecResult {
  const resolved = resolveCommand(command);
  try {
    const result = execSync([resolved, ...args].join(" "), {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? "").toString().trim(),
      exitCode: e.status ?? 1,
    };
  }
}

/**
 * Execute a command with streaming output (stdout/stderr pass-through)
 * Returns the exit code.
 * Resolves vendored binaries before falling back to system PATH.
 */
export function stream(command: string, args: string[] = [], cwd?: string): Promise<number> {
  const resolved = resolveCommand(command);
  return new Promise((resolve) => {
    const opts: SpawnOptions = {
      cwd,
      stdio: "inherit",
      shell: true,
    };
    const child = spawn(resolved, args, opts);
    trackChild(child);
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.warn(`[exec] Child process error: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Check if a command exists, checking vendor directory first, then system PATH.
 */
export function commandExists(command: string): boolean {
  return commandExistsWithVendor(command);
}
