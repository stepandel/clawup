/**
 * Tools Module
 *
 * Platform-agnostic tool implementations using the RuntimeAdapter pattern.
 * Each tool is a ToolImplementation that can run with any adapter.
 *
 * @example
 * import { deployTool, createCLIAdapter } from './tools';
 *
 * // Run with CLI adapter
 * await deployTool(createCLIAdapter(), { yes: false });
 */

// Export all tools
export { deployTool, type DeployOptions } from "./deploy";
export { statusTool, type StatusOptions } from "./status";
export { validateTool, type ValidateOptions } from "./validate";
export { destroyTool, type DestroyOptions } from "./destroy";

// Re-export adapter types and factory for convenience
export {
  type RuntimeAdapter,
  type ToolImplementation,
  type ToolDefinition,
  createCLIAdapter,
} from "../adapters";
