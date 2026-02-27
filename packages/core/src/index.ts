/**
 * @clawup/core — shared types, constants, registries, and utilities
 */

// Types
export type {
  AgentDefinition,
  ClawupManifest,
  IdentityManifest,
  IdentityResult,
  PluginConfigFile,
  PrereqResult,
  VoidResult,
  Result,
} from "./types";
export { validateAgentDefinition } from "./types";

// Constants
export {
  AGENT_ALIASES,
  AWS_REGIONS,
  BUILT_IN_IDENTITIES,
  CONFIG_DIR,
  COST_ESTIMATES,
  HETZNER_COST_ESTIMATES,
  LOCAL_COST_ESTIMATES,
  HETZNER_LOCATIONS,
  HETZNER_SERVER_TYPES_EU,
  HETZNER_SERVER_TYPES_US,
  HETZNER_US_LOCATIONS,
  INSTANCE_TYPES,
  KEY_INSTRUCTIONS,
  MANIFEST_FILE,
  MODEL_PROVIDERS,
  PLUGINS_DIR,
  PROVIDERS,
  SSH_USER,
  getProviderForModel,
  hetznerServerTypes,
  slackAppManifest,
  tailscaleHostname,
  dockerContainerName,
} from "./constants";

// Plugin registry
export type { PluginRegistryEntry, PluginManifest, PluginSecret } from "./plugin-registry";
export { PLUGIN_REGISTRY, PLUGIN_MANIFEST_REGISTRY, getSecretEnvVars } from "./plugin-registry";

// Plugin loader
export {
  resolvePlugin,
  resolvePlugins,
  collectPluginSecrets,
  buildKnownSecrets,
  buildValidators,
  isSecretCoveredByPlugin,
} from "./plugin-loader";

// Manifest hooks — re-exported from "@clawup/core/manifest-hooks" subpath
// to avoid pulling child_process into browser bundles.

// Coding agent registry
export type { CodingAgentEntry, CodingAgentSecret } from "./coding-agent-registry";
export { CODING_AGENT_REGISTRY } from "./coding-agent-registry";

// Dep registry
export type { DepSecret, DepRegistryEntry } from "./dep-registry";
export { DEP_REGISTRY } from "./dep-registry";

// Deps
export type { ResolvedDep } from "./deps";
export { resolveDeps, collectDepSecrets } from "./deps";

// Skills
export type { ParsedSkill } from "./skills";
export { CLAWHUB_PREFIX, parseSkill, classifySkills } from "./skills";

// Identity — re-exported from "@clawup/core/identity" subpath to avoid
// pulling Node.js-only modules (fs, child_process) into browser bundles.

// Schemas
export {
  AgentDefinitionSchema,
  ClawupManifestSchema,
  PluginConfigFileSchema,
  IdentityManifestSchema,
  PluginManifestSchema,
  PluginSecretSchema,
  PluginHooksSchema,
  WebhookSetupSchema,
  ConfigTransformSchema,
} from "./schemas";
