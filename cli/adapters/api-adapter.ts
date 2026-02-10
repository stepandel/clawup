/**
 * API Runtime Adapter
 *
 * Implements RuntimeAdapter for HTTP API usage.
 * Instead of interactive prompts, collects inputs from a request body
 * and accumulates responses as structured JSON.
 */

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
  LogAdapter,
} from "./types";

// ============================================================================
// API Response Types
// ============================================================================

/** A field descriptor returned instead of prompting */
export interface FieldDescriptor {
  type: "text" | "confirm" | "select" | "multiSelect";
  name: string;
  message: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: Array<{ value: unknown; label: string; hint?: string }>;
  required?: boolean;
}

/** A log entry accumulated during execution */
export interface LogEntry {
  level: "info" | "step" | "success" | "warn" | "error";
  message: string;
  timestamp: number;
}

/** Accumulated API response */
export interface APIResponse {
  /** Fields that need user input (wizard mode) */
  fields: FieldDescriptor[];
  /** Log messages accumulated during execution */
  logs: LogEntry[];
  /** Notes/messages shown to the user */
  messages: Array<{ type: "intro" | "note" | "outro" | "cancel"; content: string; title?: string }>;
  /** Whether the operation completed or needs more input */
  status: "needsInput" | "complete" | "cancelled" | "error";
}

// ============================================================================
// Execution Adapter Implementation
// ============================================================================

class APIExecAdapter implements ExecAdapter {
  capture(command: string, args: string[] = [], cwd?: string): ExecResult {
    // In API context, we use the same exec approach but capture output
    const { execSync } = require("child_process");
    try {
      const result = execSync([command, ...args].join(" "), {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { stdout: (result as string).trim(), stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: (e.stdout ?? "").toString().trim(),
        stderr: (e.stderr ?? "").toString().trim(),
        exitCode: e.status ?? 1,
      };
    }
  }

  async stream(command: string, args: string[] = [], options?: StreamOptions): Promise<number> {
    // In API context, always capture output
    const result = this.capture(command, args, options?.cwd);
    return result.exitCode;
  }

  commandExists(command: string): boolean {
    const { execSync } = require("child_process");
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

class APIUIAdapter implements UIAdapter {
  private response: APIResponse;
  private inputs: Record<string, unknown>;
  private fieldIndex = 0;

  constructor(inputs: Record<string, unknown>, response: APIResponse) {
    this.inputs = inputs;
    this.response = response;
  }

  intro(message: string): void {
    this.response.messages.push({ type: "intro", content: message });
  }

  note(content: string, title?: string): void {
    this.response.messages.push({ type: "note", content, title });
  }

  outro(message: string): void {
    this.response.messages.push({ type: "outro", content: message });
    this.response.status = "complete";
  }

  cancel(message: string): never {
    this.response.messages.push({ type: "cancel", content: message });
    this.response.status = "cancelled";
    throw new APIAdapterCancelError(message);
  }

  log: LogAdapter = {
    info: (message: string): void => {
      this.response.logs.push({ level: "info", message, timestamp: Date.now() });
    },
    step: (message: string): void => {
      this.response.logs.push({ level: "step", message, timestamp: Date.now() });
    },
    success: (message: string): void => {
      this.response.logs.push({ level: "success", message, timestamp: Date.now() });
    },
    warn: (message: string): void => {
      this.response.logs.push({ level: "warn", message, timestamp: Date.now() });
    },
    error: (message: string): void => {
      this.response.logs.push({ level: "error", message, timestamp: Date.now() });
    },
  };

  async text(options: TextOptions): Promise<string> {
    const fieldName = `field_${this.fieldIndex++}`;

    // Check if input was provided
    if (fieldName in this.inputs || options.message in this.inputs) {
      const key = fieldName in this.inputs ? fieldName : options.message;
      const value = String(this.inputs[key]);
      if (options.validate) {
        const error = options.validate(value);
        if (error) {
          throw new APIAdapterValidationError(fieldName, error);
        }
      }
      return value;
    }

    // No input provided — add field descriptor for client
    this.response.fields.push({
      type: "text",
      name: fieldName,
      message: options.message,
      placeholder: options.placeholder,
      defaultValue: options.defaultValue,
    });
    this.response.status = "needsInput";
    throw new APIAdapterNeedsInputError(fieldName);
  }

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const fieldName = `field_${this.fieldIndex++}`;

    if (fieldName in this.inputs || options.message in this.inputs) {
      const key = fieldName in this.inputs ? fieldName : options.message;
      return Boolean(this.inputs[key]);
    }

    this.response.fields.push({
      type: "confirm",
      name: fieldName,
      message: options.message,
      defaultValue: options.initialValue,
    });
    this.response.status = "needsInput";
    throw new APIAdapterNeedsInputError(fieldName);
  }

  async select<T>(options: SelectOptions<T>): Promise<T> {
    const fieldName = `field_${this.fieldIndex++}`;

    if (fieldName in this.inputs || options.message in this.inputs) {
      const key = fieldName in this.inputs ? fieldName : options.message;
      return this.inputs[key] as T;
    }

    this.response.fields.push({
      type: "select",
      name: fieldName,
      message: options.message,
      options: options.options.map((o) => ({
        value: o.value as unknown,
        label: o.label,
        hint: o.hint,
      })),
      defaultValue: options.initialValue,
    });
    this.response.status = "needsInput";
    throw new APIAdapterNeedsInputError(fieldName);
  }

  async multiSelect<T>(options: MultiSelectOptions<T>): Promise<T[]> {
    const fieldName = `field_${this.fieldIndex++}`;

    if (fieldName in this.inputs || options.message in this.inputs) {
      const key = fieldName in this.inputs ? fieldName : options.message;
      const value = this.inputs[key];
      return Array.isArray(value) ? value : [value as T];
    }

    this.response.fields.push({
      type: "multiSelect",
      name: fieldName,
      message: options.message,
      options: options.options.map((o) => ({
        value: o.value as unknown,
        label: o.label,
        hint: o.hint,
      })),
      defaultValue: options.initialValues,
      required: options.required,
    });
    this.response.status = "needsInput";
    throw new APIAdapterNeedsInputError(fieldName);
  }

  spinner(message: string): SpinnerController {
    this.response.logs.push({ level: "info", message: `[spinner] ${message}`, timestamp: Date.now() });
    return {
      stop(msg?: string) {
        // No-op in API mode
      },
      message(_msg: string) {
        // No-op in API mode
      },
    };
  }
}

// ============================================================================
// Error Types
// ============================================================================

/** Thrown when the adapter needs more input from the client */
export class APIAdapterNeedsInputError extends Error {
  constructor(public fieldName: string) {
    super(`Input required for field: ${fieldName}`);
    this.name = "APIAdapterNeedsInputError";
  }
}

/** Thrown when validation fails on a provided input */
export class APIAdapterValidationError extends Error {
  constructor(
    public fieldName: string,
    public validationMessage: string
  ) {
    super(`Validation failed for ${fieldName}: ${validationMessage}`);
    this.name = "APIAdapterValidationError";
  }
}

/** Thrown when the operation is cancelled */
export class APIAdapterCancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "APIAdapterCancelError";
  }
}

// ============================================================================
// Runtime Adapter
// ============================================================================

/**
 * Create an API runtime adapter for HTTP request handling.
 *
 * @param inputs - Key-value pairs from the request body providing answers to wizard fields
 * @returns A tuple of [RuntimeAdapter, APIResponse] — use the response to send back to the client
 *
 * @example
 * const [adapter, response] = createAPIAdapter({ field_0: "my-project", field_1: "aws" });
 * try {
 *   await initTool(adapter, {});
 * } catch (e) {
 *   if (e instanceof APIAdapterNeedsInputError) {
 *     // Return response.fields to client for more input
 *   }
 * }
 * res.json(response);
 */
export function createAPIAdapter(inputs: Record<string, unknown> = {}): [RuntimeAdapter, APIResponse] {
  const response: APIResponse = {
    fields: [],
    logs: [],
    messages: [],
    status: "complete",
  };

  const adapter: RuntimeAdapter = {
    ui: new APIUIAdapter(inputs, response),
    exec: new APIExecAdapter(),
    platform: "api",
  };

  return [adapter, response];
}
