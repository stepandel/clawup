/**
 * Plugin loader — resolution chain and utility functions.
 *
 * Three-tier resolution: built-in registry > generic fallback.
 * Unknown plugins work with zero manifest via the generic fallback.
 */

import { PLUGIN_MANIFEST_REGISTRY, type PluginManifest, type PluginSecret } from "./plugin-registry";

/**
 * Resolve a single plugin by name.
 * Returns the enriched manifest from the built-in registry, or a generic fallback
 * for unknown plugins.
 */
export function resolvePlugin(name: string): PluginManifest {
  // Check built-in registry
  const builtin = PLUGIN_MANIFEST_REGISTRY[name];
  if (builtin) return builtin;

  // Generic fallback — unknown plugins work with manual config
  return {
    name,
    displayName: name,
    installable: true,
    needsFunnel: false,
    configPath: "plugins.entries",
    secrets: {},
    internalKeys: [],
    configTransforms: [],
  };
}

/**
 * Batch-resolve multiple plugins.
 */
export function resolvePlugins(names: string[]): PluginManifest[] {
  return names.map((name) => resolvePlugin(name));
}

/**
 * Collect all secrets from resolved plugin manifests.
 * Returns a flat list with plugin name attached for context.
 */
export function collectPluginSecrets(
  plugins: PluginManifest[]
): Array<{ pluginName: string; configKey: string; secret: PluginSecret }> {
  const result: Array<{ pluginName: string; configKey: string; secret: PluginSecret }> = [];
  for (const plugin of plugins) {
    for (const [key, secret] of Object.entries(plugin.secrets)) {
      result.push({ pluginName: plugin.name, configKey: key, secret });
    }
  }
  return result;
}

/**
 * Build a dynamic KNOWN_SECRETS map from resolved plugin manifests.
 * Returns entries in the format expected by the secrets command.
 */
export function buildKnownSecrets(
  plugins: PluginManifest[]
): Record<string, { label: string; perAgent: boolean; isSecret: boolean }> {
  const result: Record<string, { label: string; perAgent: boolean; isSecret: boolean }> = {};
  for (const plugin of plugins) {
    for (const [key, secret] of Object.entries(plugin.secrets)) {
      result[key] = {
        label: `${plugin.displayName} ${formatSecretLabel(key)}`,
        perAgent: secret.scope === "agent",
        isSecret: secret.isSecret,
      };
    }
  }
  return result;
}

/**
 * Build a dynamic VALIDATORS map from resolved plugin manifests.
 * Returns entries in the format expected by env.ts validation.
 */
export function buildValidators(
  plugins: PluginManifest[]
): Record<string, (val: string) => string | undefined> {
  const result: Record<string, (val: string) => string | undefined> = {};
  for (const plugin of plugins) {
    for (const [key, secret] of Object.entries(plugin.secrets)) {
      if (secret.validator) {
        const prefix = secret.validator;
        result[key] = (val: string) => {
          if (!val.startsWith(prefix)) return `Must start with ${prefix}`;
        };
      }
    }
  }
  return result;
}

/**
 * Check if a secret key is already covered by a plugin's secrets definition.
 * Used to avoid duplicate entries in requiredSecrets.
 */
export function isSecretCoveredByPlugin(
  key: string,
  resolvedPlugins: PluginManifest[]
): boolean {
  for (const plugin of resolvedPlugins) {
    if (key in plugin.secrets) return true;
  }
  return false;
}

/**
 * Convert a camelCase config key to a human-readable label.
 * e.g., "apiKey" → "API Key", "botToken" → "Bot Token"
 */
function formatSecretLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
