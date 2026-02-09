/**
 * CLI Runtime Adapter
 *
 * Implements RuntimeAdapter for interactive terminal usage
 * using @clack/prompts for UI and child_process for execution.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync, spawn, type SpawnOptions } from "child_process";
import type {
  RuntimeAdapter,
  UIAdapter,
  ExecAdapter,
  ExecResult,
  TextOptions,
  ConfirmOptions,
  SelectOptions,
  MultiSelectOptions,
  SpinnerController,
  StreamOptions,
} from "./types";

// ============================================================================
// Execution Adapter Implementation
// ============================================================================

class CLIExecAdapter implements ExecAdapter {
  capture(command: string, args: string[] = [], cwd?: string): ExecResult {
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

  stream(command: string, args: string[] = [], options?: StreamOptions): Promise<number> {
    return new Promise((resolve) => {
      const opts: SpawnOptions = {
        cwd: options?.cwd,
        stdio: options?.capture ? "pipe" : "inherit",
        shell: true,
      };
      const child = spawn(command, args, opts);
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
  }

  commandExists(command: string): boolean {
    try {
      execSync(`command -v ${command}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// UI Adapter Implementation
// ============================================================================

class CLIUIAdapter implements UIAdapter {
  intro(message: string): void {
    console.log();
    p.intro(pc.bgCyan(pc.black(` ${message} `)));
  }

  note(content: string, title?: string): void {
    p.note(content, title);
  }

  outro(message: string): void {
    p.outro(message);
  }

  cancel(message: string): never {
    p.cancel(message);
    process.exit(0);
  }

  log = {
    info(message: string): void {
      p.log.info(message);
    },
    step(message: string): void {
      p.log.step(message);
    },
    success(message: string): void {
      p.log.success(message);
    },
    warn(message: string): void {
      p.log.warn(message);
    },
    error(message: string): void {
      p.log.error(message);
    },
  };

  async text(options: TextOptions): Promise<string> {
    const result = await p.text({
      message: options.message,
      placeholder: options.placeholder,
      defaultValue: options.defaultValue,
      validate: options.validate,
    });

    if (p.isCancel(result)) {
      this.cancel("Operation cancelled.");
    }

    return result as string;
  }

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const result = await p.confirm({
      message: options.message,
      initialValue: options.initialValue,
    });

    if (p.isCancel(result)) {
      this.cancel("Operation cancelled.");
    }

    return result as boolean;
  }

  async select<T>(options: SelectOptions<T>): Promise<T> {
    const result = await p.select({
      message: options.message,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: options.options as any,
      initialValue: options.initialValue,
    });

    if (p.isCancel(result)) {
      this.cancel("Operation cancelled.");
    }

    return result as T;
  }

  async multiSelect<T>(options: MultiSelectOptions<T>): Promise<T[]> {
    const result = await p.multiselect({
      message: options.message,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: options.options as any,
      initialValues: options.initialValues,
      required: options.required,
    });

    if (p.isCancel(result)) {
      this.cancel("Operation cancelled.");
    }

    return result as T[];
  }

  spinner(message: string): SpinnerController {
    const s = p.spinner();
    s.start(message);
    return {
      stop(msg?: string, code?: number) {
        s.stop(msg, code);
      },
      message(msg: string) {
        s.message(msg);
      },
    };
  }
}

// ============================================================================
// Runtime Adapter
// ============================================================================

/**
 * Create a CLI runtime adapter for interactive terminal usage
 */
export function createCLIAdapter(): RuntimeAdapter {
  return {
    ui: new CLIUIAdapter(),
    exec: new CLIExecAdapter(),
    platform: "cli",
  };
}

/**
 * Singleton CLI adapter instance for convenience
 */
export const cliAdapter = createCLIAdapter();
