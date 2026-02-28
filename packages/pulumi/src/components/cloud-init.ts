/**
 * Shared types and utilities used by the Nix entrypoint and cloud-init generators.
 */

/**
 * Config for a plugin to be installed on an agent.
 */
export interface PluginInstallConfig {
  /** Plugin package name (e.g., "openclaw-linear") */
  name: string;
  /** Non-secret config for this plugin's agent section */
  config?: Record<string, unknown>;
  /**
   * Env var mappings for secrets: { configKey: envVarName }
   * e.g., { "apiKey": "LINEAR_API_KEY", "webhookSecret": "LINEAR_WEBHOOK_SECRET" }
   */
  secretEnvVars?: Record<string, string>;
  /** false for built-in plugins like Slack that don't need `openclaw plugins install` */
  installable?: boolean;
  /** Where this plugin's config lives in openclaw.json: "plugins.entries" or "channels" */
  configPath?: "plugins.entries" | "channels";
  /** Keys that are clawup-internal metadata and should NOT be written to OpenClaw config */
  internalKeys?: string[];
  /** Config transforms to apply before writing (e.g., dm flattening for Slack) */
  configTransforms?: Array<{
    sourceKey: string;
    targetKeys: Record<string, string>;
    removeSource: boolean;
  }>;
  /** Lifecycle hooks from the plugin manifest */
  hooks?: {
    resolve?: Record<string, string>;
    postProvision?: string;
    preStart?: string;
  };
}

/**
 * Interpolates secret placeholders in a generated script.
 *
 * Replaces ${TAILSCALE_AUTH_KEY}, ${GATEWAY_TOKEN}, and any additional
 * secret env vars (provider API keys, plugin secrets, dep secrets) with
 * their resolved values.
 */
export function interpolateCloudInit(
  script: string,
  values: {
    tailscaleAuthKey: string;
    gatewayToken: string;
    /** All secret env vars: provider API keys, plugins, deps — { envVarName: value } */
    additionalSecrets?: Record<string, string>;
  }
): string {
  let result = script
    .replace(/\${TAILSCALE_AUTH_KEY}/g, values.tailscaleAuthKey)
    .replace(/\${GATEWAY_TOKEN}/g, values.gatewayToken);

  // All secret env vars (provider API keys, plugin tokens, dep keys, etc.)
  if (values.additionalSecrets) {
    for (const [envVar, value] of Object.entries(values.additionalSecrets)) {
      const escaped = value.replace(/\$/g, "$$$$");
      result = result.replace(new RegExp(`\\$\\{${envVar}:-\\}`, "g"), escaped);
      result = result.replace(new RegExp(`\\$\\{${envVar}\\}`, "g"), escaped);
    }
  }

  return result;
}
