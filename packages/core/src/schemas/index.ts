/**
 * Barrel export for all Zod schemas.
 */

export {
  AgentDefinitionSchema,
  ClawupManifestSchema,
  PluginConfigFileSchema,
} from "./manifest";

export {
  IdentityManifestSchema,
} from "./identity";

export {
  HooksSchema,
  PluginManifestSchema,
  PluginSecretSchema,
  WebhookSetupSchema,
  ConfigTransformSchema,
  PluginHooksSchema,
  OnboardHookSchema,
  OnboardHookInputSchema,
} from "./plugin-manifest";
