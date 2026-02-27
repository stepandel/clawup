/**
 * Shared plugin registry — enriched metadata used by both Pulumi and the CLI.
 *
 * All plugin-specific knowledge lives here. Consumers read from this registry
 * instead of hardcoding plugin-specific logic.
 */

import type { z } from "zod";
import type { PluginManifestSchema, PluginSecretSchema } from "./schemas/plugin-manifest";

/** Inferred type from the Zod schema */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginSecret = z.infer<typeof PluginSecretSchema>;

/**
 * @deprecated Use PluginManifest instead. Kept for backward compatibility during migration.
 */
export interface PluginRegistryEntry {
  /** Secret env var mappings: { configKey: envVarName } */
  secretEnvVars: Record<string, string>;
  /** Whether to run `openclaw plugins install` during cloud-init */
  installable: boolean;
  /** Whether this plugin needs Tailscale Funnel (public HTTPS for webhooks) */
  needsFunnel?: boolean;
  defaultConfig?: Record<string, unknown>;
  transformConfig?: (config: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Extract the old-style secretEnvVars map from a PluginManifest.
 * Returns { configKey: envVarName } for backward-compatible usage.
 */
export function getSecretEnvVars(manifest: PluginManifest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, secret] of Object.entries(manifest.secrets)) {
    result[key] = secret.envVar;
  }
  return result;
}

/**
 * Enriched plugin registry with full metadata for each plugin.
 */
export const PLUGIN_MANIFEST_REGISTRY: Record<string, PluginManifest> = {
  "openclaw-linear": {
    name: "openclaw-linear",
    displayName: "Linear",
    installable: true,
    needsFunnel: true,
    configPath: "plugins.entries",
    secrets: {
      apiKey: {
        envVar: "LINEAR_API_KEY",
        scope: "agent",
        isSecret: true,
        required: true,
        autoResolvable: false,
        validator: "lin_api_",
        instructions: {
          title: "Linear API Key",
          steps: [
            "Create a separate Linear account for each agent (used by openclaw-linear plugin):",
            "1. Invite you+agentname@domain.com to your Linear workspace",
            "   (plus-addressing forwards to your inbox — no new email needed)",
            "   Follow the link in the invite email to create the account and join the org",
            "2. Go to Settings → Security & Access → Personal API keys → \"New API key\"",
            "3. Copy the key (starts with lin_api_)",
          ],
        },
      },
      webhookSecret: {
        envVar: "LINEAR_WEBHOOK_SECRET",
        scope: "agent",
        isSecret: true,
        required: true,
        autoResolvable: false,
      },
      linearUserUuid: {
        envVar: "LINEAR_USER_UUID",
        scope: "agent",
        isSecret: false,
        required: false,
        autoResolvable: true,
      },
    },
    internalKeys: ["agentId", "linearUserUuid"],
    configTransforms: [],
    webhookSetup: {
      urlPath: "/hooks/linear",
      secretKey: "webhookSecret",
      instructions: [
        "1. Go to Linear Settings → API → Webhooks → \"New webhook\"",
        "2. Paste the URL above",
        "3. Select events to receive (e.g., Issues, Comments)",
        "4. Create the webhook and copy the \"Signing secret\"",
      ],
      configJsonPath: "plugins.entries.openclaw-linear.config.webhookSecret",
    },
    hooks: {
      resolve: {
        linearUserUuid: 'curl -s -X POST https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" -d \'{"query":"{ viewer { id } }"}\' | jq -r ".data.viewer.id"',
      },
    },
  },
  slack: {
    name: "slack",
    displayName: "Slack",
    installable: false,
    needsFunnel: false,
    configPath: "channels",
    secrets: {
      botToken: {
        envVar: "SLACK_BOT_TOKEN",
        scope: "agent",
        isSecret: true,
        required: true,
        autoResolvable: false,
        validator: "xoxb-",
        instructions: {
          title: "Slack App Setup",
          steps: [
            "Create a Slack app for each agent using the manifest shown below:",
            "1. Go to https://api.slack.com/apps → \"Create New App\" → \"From a manifest\"",
            "2. Select your workspace, paste the JSON manifest, and create the app",
            "3. Go to \"OAuth & Permissions\" — copy the Bot Token (xoxb-...)",
            "4. Under \"Basic Information\" → \"App-Level Tokens\", generate a token",
            "   with the connections:write scope — copy it (xapp-...)",
          ],
        },
      },
      appToken: {
        envVar: "SLACK_APP_TOKEN",
        scope: "agent",
        isSecret: true,
        required: true,
        autoResolvable: false,
        validator: "xapp-",
      },
    },
    internalKeys: [],
    configTransforms: [
      {
        sourceKey: "dm",
        targetKeys: { policy: "dmPolicy", allowFrom: "allowFrom" },
        removeSource: true,
      },
    ],
  },
};

/**
 * Legacy PLUGIN_REGISTRY — wraps PLUGIN_MANIFEST_REGISTRY for backward compatibility.
 * @deprecated Use PLUGIN_MANIFEST_REGISTRY directly.
 */
export const PLUGIN_REGISTRY: Record<string, PluginRegistryEntry> = Object.fromEntries(
  Object.entries(PLUGIN_MANIFEST_REGISTRY).map(([name, manifest]) => {
    const entry: PluginRegistryEntry = {
      secretEnvVars: getSecretEnvVars(manifest),
      installable: manifest.installable,
      needsFunnel: manifest.needsFunnel || undefined,
      defaultConfig: manifest.defaultConfig,
    };

    // Preserve the Linear transformConfig behavior
    if (name === "openclaw-linear") {
      entry.transformConfig = (config) => {
        const uuid = config.linearUserUuid as string | undefined;
        const mapping: Record<string, string> = {};
        if (uuid) {
          mapping[uuid] = "default";
        }
        mapping["$AGENT_NAME"] = "default";
        config.agentMapping = mapping;
        return config;
      };
    }

    return [name, entry];
  })
);
