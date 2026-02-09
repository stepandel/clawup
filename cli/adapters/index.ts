/**
 * Runtime Adapters Module
 *
 * Provides platform-agnostic abstractions for UI and execution,
 * enabling the same core command logic to run in different environments.
 *
 * @example
 * import { createCLIAdapter, type RuntimeAdapter, type ToolImplementation } from './adapters';
 *
 * const myTool: ToolImplementation<{ name: string }> = async (runtime, options) => {
 *   runtime.ui.intro("My Tool");
 *   const name = options.name || await runtime.ui.text({ message: "Enter name:" });
 *   runtime.ui.log.success(`Hello, ${name}!`);
 * };
 *
 * // Run with CLI adapter
 * await myTool(createCLIAdapter(), { name: "World" });
 */

// Export types
export type {
  RuntimeAdapter,
  UIAdapter,
  ExecAdapter,
  LogAdapter,
  ExecResult,
  TextOptions,
  ConfirmOptions,
  SelectOptions,
  SelectOption,
  MultiSelectOptions,
  SpinnerController,
  StreamOptions,
  ToolImplementation,
  ToolDefinition,
} from "./types";

// Export CLI adapter
export { createCLIAdapter, cliAdapter } from "./cli-adapter";
