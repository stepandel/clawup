/**
 * Re-export all types from @agent-army/core for backward compatibility.
 * External consumers importing "agent-army/types" will get these.
 */
export {
  validateAgentDefinition,
} from "@agent-army/core";
export type {
  AgentDefinition,
  ArmyManifest,
  IdentityManifest,
  IdentityResult,
  PluginConfigFile,
  PrereqResult,
} from "@agent-army/core";
