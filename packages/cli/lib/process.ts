/**
 * Graceful shutdown and child process tracking.
 *
 * Spawn helpers in exec.ts and cli-adapter.ts register child processes here.
 * bin.ts calls setupGracefulShutdown() at startup so that SIGINT / SIGTERM
 * are forwarded to any running children before the CLI exits.
 */

import type { ChildProcess } from "child_process";

const activeChildren = new Set<ChildProcess>();

/**
 * Register a child process for cleanup on exit.
 * Automatically unregisters when the child closes or errors.
 */
export function trackChild(child: ChildProcess): void {
  activeChildren.add(child);
  const remove = () => activeChildren.delete(child);
  child.on("close", remove);
  child.on("error", remove);
}

/**
 * Install SIGINT and SIGTERM handlers that forward the signal
 * to tracked child processes before exiting.
 */
export function setupGracefulShutdown(): void {
  const cleanup = (signal: NodeJS.Signals, exitCode: number) => {
    for (const child of activeChildren) {
      child.kill(signal);
    }
    process.exit(exitCode);
  };

  process.on("SIGINT", () => cleanup("SIGINT", 130));
  process.on("SIGTERM", () => cleanup("SIGTERM", 143));
}
