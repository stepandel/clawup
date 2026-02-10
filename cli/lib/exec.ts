/**
 * Child process helpers for CLI commands
 */

import { execSync, spawn, spawnSync, type SpawnOptions } from "child_process";
import { trackChild } from "./process";

/** Result of a captured command execution */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command and capture output
 */
export function capture(command: string, args: string[] = [], cwd?: string): ExecResult {
  try {
    const result = execSync([command, ...args].join(" "), {
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
 */
export function stream(command: string, args: string[] = [], cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = {
      cwd,
      stdio: "inherit",
      shell: true,
    };
    const child = spawn(command, args, opts);
    trackChild(child);
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.warn(`[exec] Child process error: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Check if a command exists on the system
 */
export function commandExists(command: string): boolean {
  const bin = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(bin, [command], { shell: false, stdio: "ignore" });
  return result.status === 0;
}
