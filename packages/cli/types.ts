/**
 * Re-export all types from @clawup/core for backward compatibility.
 * External consumers importing "clawup/types" will get these.
 */
export {
  validateAgentDefinition,
} from "@clawup/core";
export type {
  AgentDefinition,
  ClawupManifest,
  IdentityManifest,
  IdentityResult,
  PluginConfigFile,
  PrereqResult,
} from "@clawup/core";
