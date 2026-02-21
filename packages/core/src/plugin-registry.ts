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
}

export const PLUGIN_REGISTRY: Record<string, PluginRegistryEntry> = {
  "openclaw-linear": {
    secretEnvVars: {
      apiKey: "LINEAR_API_KEY",
      webhookSecret: "LINEAR_WEBHOOK_SECRET",
    },
    installable: true,
    needsFunnel: true,
  },
  slack: {
    secretEnvVars: {
      botToken: "SLACK_BOT_TOKEN",
      appToken: "SLACK_APP_TOKEN",
    },
    installable: false,
  },
};
