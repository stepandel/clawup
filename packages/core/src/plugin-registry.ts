/**
 * Shared plugin registry — metadata used by both index.ts (Pulumi) and the CLI.
 */

export interface PluginRegistryEntry {
  /** Secret env var mappings: { configKey: envVarName } */
  secretEnvVars: Record<string, string>;
  /** Whether to run `openclaw plugins install` during cloud-init */
  installable: boolean;
  /** Whether this plugin needs Tailscale Funnel (public HTTPS for webhooks) */
  needsFunnel?: boolean;
  /**
   * Default config values for this plugin. Merged as lowest-priority defaults
   * (identity defaults and manifest inline config override these).
   *
   * Values can use $ENV_VAR syntax to reference runtime environment variables.
   * e.g., { "$AGENT_NAME": "default" } → {os.environ.get("AGENT_NAME", ""): "default"}
   */
  defaultConfig?: Record<string, unknown>;
  /**
   * Transform the raw plugin config before it's passed to the config generator.
   * Runs at deploy time (in Node.js) after defaults are merged.
   * Use this for config values that depend on other config fields
   * (e.g., building agentMapping from linearUserUuid).
   */
  transformConfig?: (config: Record<string, unknown>) => Record<string, unknown>;
}

export const PLUGIN_REGISTRY: Record<string, PluginRegistryEntry> = {
  "openclaw-linear": {
    secretEnvVars: {
      apiKey: "LINEAR_API_KEY",
      webhookSecret: "LINEAR_WEBHOOK_SECRET",
    },
    installable: true,
    needsFunnel: true,
    transformConfig: (config) => {
      // Build agentMapping from linearUserUuid: the Linear plugin routes
      // webhook events by looking up the assignee's UUID in agentMapping.
      // Include both UUID and display name ($AGENT_NAME env var at runtime)
      // so the plugin can match by either identifier.
      const uuid = config.linearUserUuid as string | undefined;
      const mapping: Record<string, string> = {};
      if (uuid) {
        mapping[uuid] = "default";
      }
      // $AGENT_NAME is resolved at runtime via toPythonLiteral() → os.environ.get()
      mapping["$AGENT_NAME"] = "default";
      config.agentMapping = mapping;
      return config;
    },
  },
  slack: {
    secretEnvVars: {
      botToken: "SLACK_BOT_TOKEN",
      appToken: "SLACK_APP_TOKEN",
    },
    installable: false,
  },
};
