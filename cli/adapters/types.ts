/**
 * Runtime Adapter Interfaces
 *
 * These interfaces define the contract between the core command logic
 * and the runtime environment (CLI, API server, etc.).
 *
 * This pattern allows the same core to run with different adapters:
 * - CLIAdapter: Interactive terminal with @clack/prompts
 * - APIAdapter: HTTP server returning JSON responses (future)
 * - TestAdapter: Mock adapter for testing (future)
 */

// ============================================================================
// Execution Types
// ============================================================================

/** Result of a captured command execution */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Options for streaming command execution */
export interface StreamOptions {
  cwd?: string;
  /** If true, capture output instead of streaming to console */
  capture?: boolean;
}

// ============================================================================
// UI Adapter
// ============================================================================

/** Select option for prompts */
export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Text input options */
export interface TextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}

/** Confirm options */
export interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
}

/** Select options */
export interface SelectOptions<T> {
  message: string;
  options: SelectOption<T>[];
  initialValue?: T;
}

/** Multi-select options */
export interface MultiSelectOptions<T> {
  message: string;
  options: SelectOption<T>[];
  initialValues?: T[];
  required?: boolean;
}

/** Logging interface */
export interface LogAdapter {
  info(message: string): void;
  step(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** User interface adapter for prompts and output */
export interface UIAdapter {
  /** Show introductory banner/message */
  intro(message: string): void;

  /** Show a note/info box */
  note(content: string, title?: string): void;

  /** Show outro/closing message */
  outro(message: string): void;

  /** Show cancellation message and exit */
  cancel(message: string): never;

  /** Logging methods */
  log: LogAdapter;

  /** Prompt for text input */
  text(options: TextOptions): Promise<string>;

  /** Prompt for yes/no confirmation */
  confirm(options: ConfirmOptions): Promise<boolean>;

  /** Prompt for single selection */
  select<T>(options: SelectOptions<T>): Promise<T>;

  /** Prompt for multiple selection */
  multiSelect<T>(options: MultiSelectOptions<T>): Promise<T[]>;

  /** Start a loading spinner */
  spinner(message: string): SpinnerController;
}

/** Spinner control interface */
export interface SpinnerController {
  stop(message?: string, code?: number): void;
  message(msg: string): void;
}

// ============================================================================
// Execution Adapter
// ============================================================================

/** Command execution adapter */
export interface ExecAdapter {
  /** Execute a command and capture output */
  capture(command: string, args?: string[], cwd?: string): ExecResult;

  /** Execute a command with streaming output, returns exit code */
  stream(command: string, args?: string[], options?: StreamOptions): Promise<number>;

  /** Check if a command exists on the system */
  commandExists(command: string): boolean;
}

// ============================================================================
// Runtime Adapter
// ============================================================================

/** Combined runtime adapter providing all platform abstractions */
export interface RuntimeAdapter {
  /** User interface adapter */
  ui: UIAdapter;

  /** Command execution adapter */
  exec: ExecAdapter;

  /** Platform identifier for conditional logic */
  platform: "cli" | "api" | "test";
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * A tool implementation is a function that performs a command action
 * using the provided runtime adapter. This allows the same logic to
 * work across different runtime environments.
 *
 * @example
 * const deployTool: ToolImplementation<DeployOptions> = async (runtime, options) => {
 *   const { ui, exec } = runtime;
 *   ui.intro("Deploying agents...");
 *   const result = exec.capture("pulumi", ["up", "--yes"]);
 *   if (result.exitCode !== 0) {
 *     ui.log.error("Deployment failed");
 *   }
 * };
 */
export type ToolImplementation<TOptions = Record<string, unknown>> = (
  runtime: RuntimeAdapter,
  options: TOptions
) => Promise<void>;

/**
 * Tool definition with metadata
 */
export interface ToolDefinition<TOptions = Record<string, unknown>> {
  /** Tool name/identifier */
  name: string;

  /** Human-readable description */
  description: string;

  /** The implementation function */
  execute: ToolImplementation<TOptions>;
}
