/**
 * Test Runtime Adapter
 *
 * Implements RuntimeAdapter for E2E testing:
 * - TestExecAdapter: Real command execution (needed for Pulumi/Docker)
 * - TestUIAdapter: Captures all output for assertions, pre-loaded prompt answers
 */

import { execSync, spawn, type SpawnOptions } from "child_process";
import type {
  RuntimeAdapter,
  UIAdapter,
  ExecAdapter,
  ExecResult,
  LogAdapter,
  TextOptions,
  ConfirmOptions,
  SelectOptions,
  MultiSelectOptions,
  SpinnerController,
  StreamOptions,
} from "../../adapters/types";

// ============================================================================
// Error types
// ============================================================================

/** Thrown when the test UI adapter's cancel() is called */
export class TestCancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestCancelError";
  }
}

// ============================================================================
// Log entry tracking
// ============================================================================

export interface LogEntry {
  level: "info" | "step" | "success" | "warn" | "error";
  message: string;
}

export interface NoteEntry {
  content: string;
  title?: string;
}

export interface SpinnerEntry {
  startMessage: string;
  stopMessage?: string;
}

// ============================================================================
// Prompt answer types
// ============================================================================

export interface PromptAnswers {
  text?: string[];
  confirm?: boolean[];
  select?: unknown[];
  multiSelect?: unknown[][];
}

// ============================================================================
// Test Exec Adapter — Real execution
// ============================================================================

class TestExecAdapter implements ExecAdapter {
  capture(command: string, args: string[] = [], cwd?: string): ExecResult {
    try {
      const result = execSync([command, ...args].join(" "), {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
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
      execSync(`which ${command}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Test UI Adapter — Captures output, returns pre-loaded answers
// ============================================================================

export class TestUIAdapter implements UIAdapter {
  logs: LogEntry[] = [];
  notes: NoteEntry[] = [];
  spinners: SpinnerEntry[] = [];
  intros: string[] = [];
  outros: string[] = [];
  cancels: string[] = [];

  private textAnswers: string[];
  private confirmAnswers: boolean[];
  private selectAnswers: unknown[];
  private multiSelectAnswers: unknown[][];
  private textIndex = 0;
  private confirmIndex = 0;
  private selectIndex = 0;
  private multiSelectIndex = 0;

  constructor(answers: PromptAnswers = {}) {
    this.textAnswers = answers.text ?? [];
    this.confirmAnswers = answers.confirm ?? [];
    this.selectAnswers = answers.select ?? [];
    this.multiSelectAnswers = answers.multiSelect ?? [];
  }

  intro(message: string): void {
    this.intros.push(message);
  }

  note(content: string, title?: string): void {
    this.notes.push({ content, title });
  }

  outro(message: string): void {
    this.outros.push(message);
  }

  cancel(message: string): never {
    this.cancels.push(message);
    throw new TestCancelError(message);
  }

  log: LogAdapter = {
    info: (message: string) => {
      this.logs.push({ level: "info", message });
    },
    step: (message: string) => {
      this.logs.push({ level: "step", message });
    },
    success: (message: string) => {
      this.logs.push({ level: "success", message });
    },
    warn: (message: string) => {
      this.logs.push({ level: "warn", message });
    },
    error: (message: string) => {
      this.logs.push({ level: "error", message });
    },
  };

  async text(options: TextOptions): Promise<string> {
    if (this.textIndex < this.textAnswers.length) {
      return this.textAnswers[this.textIndex++];
    }
    return options.defaultValue ?? "";
  }

  async confirm(options: ConfirmOptions): Promise<boolean> {
    if (this.confirmIndex < this.confirmAnswers.length) {
      return this.confirmAnswers[this.confirmIndex++];
    }
    return options.initialValue ?? true;
  }

  async select<T>(options: SelectOptions<T>): Promise<T> {
    if (this.selectIndex < this.selectAnswers.length) {
      return this.selectAnswers[this.selectIndex++] as T;
    }
    return options.initialValue ?? options.options[0].value;
  }

  async multiSelect<T>(options: MultiSelectOptions<T>): Promise<T[]> {
    if (this.multiSelectIndex < this.multiSelectAnswers.length) {
      return this.multiSelectAnswers[this.multiSelectIndex++] as T[];
    }
    return options.initialValues ?? [];
  }

  spinner(message: string): SpinnerController {
    const entry: SpinnerEntry = { startMessage: message };
    this.spinners.push(entry);
    return {
      stop(msg?: string) {
        entry.stopMessage = msg;
      },
      message(msg: string) {
        entry.startMessage = msg;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Assertion helpers
  // -------------------------------------------------------------------------

  hasLog(level: LogEntry["level"], pattern: string | RegExp): boolean {
    return this.logs.some(
      (l) =>
        l.level === level &&
        (typeof pattern === "string"
          ? l.message.includes(pattern)
          : pattern.test(l.message)),
    );
  }

  hasNote(title: string): boolean {
    return this.notes.some((n) => n.title === title);
  }

  hasNoteContent(pattern: string | RegExp): boolean {
    return this.notes.some((n) =>
      typeof pattern === "string"
        ? n.content.includes(pattern)
        : pattern.test(n.content),
    );
  }

  reset(): void {
    this.logs = [];
    this.notes = [];
    this.spinners = [];
    this.intros = [];
    this.outros = [];
    this.cancels = [];
    this.textIndex = 0;
    this.confirmIndex = 0;
    this.selectIndex = 0;
    this.multiSelectIndex = 0;
  }
}

// ============================================================================
// Factory
// ============================================================================

export interface TestAdapterResult {
  adapter: RuntimeAdapter;
  ui: TestUIAdapter;
  exec: ExecAdapter;
}

export function createTestAdapter(answers?: PromptAnswers): TestAdapterResult {
  const ui = new TestUIAdapter(answers);
  const exec = new TestExecAdapter();
  const adapter: RuntimeAdapter = {
    ui,
    exec,
    platform: "test",
  };
  return { adapter, ui, exec };
}
