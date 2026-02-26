/**
 * Zod schema for PluginManifest — the enriched plugin metadata format.
 *
 * This is the source of truth for all plugin metadata. Consumers read from
 * the plugin registry (which uses this schema) instead of hardcoding
 * plugin-specific logic.
 */

import { z } from "zod";

/**
 * A single secret that a plugin requires.
 */
export const PluginSecretSchema = z.object({
  /** Environment variable name (e.g., "LINEAR_API_KEY") */
  envVar: z.string(),
  /** Whether this secret is per-agent or shared globally */
  scope: z.enum(["agent", "global"]),
  /** Whether the value should be stored encrypted (true for API keys, false for UUIDs) */
  isSecret: z.boolean(),
  /** Whether this value is required (default: true) */
  required: z.boolean().default(true),
  /** Whether this value can be auto-resolved at setup time (e.g., Linear UUID from API) */
  autoResolvable: z.boolean().default(false),
  /** Optional validator function name or prefix check (e.g., "xoxb-") */
  validator: z.string().optional(),
  /** Human-readable setup instructions for this secret */
  instructions: z.object({
    title: z.string(),
    steps: z.array(z.string()),
  }).optional(),
});

/**
 * Webhook setup configuration for plugins that need incoming webhooks.
 */
export const WebhookSetupSchema = z.object({
  /** URL path suffix for the webhook endpoint (e.g., "/hooks/linear") */
  urlPath: z.string(),
  /** The secret key name used for webhook signature verification */
  secretKey: z.string(),
  /** Human-readable setup instructions */
  instructions: z.array(z.string()),
  /** JSON path in openclaw.json where the webhook secret is stored */
  configJsonPath: z.string(),
});

/**
 * Config transform definition — describes how to transform a config key.
 */
export const ConfigTransformSchema = z.object({
  /** Source key in the raw config */
  sourceKey: z.string(),
  /** Target keys to write in the output config */
  targetKeys: z.record(z.string()),
  /** Whether to remove the source key after transform */
  removeSource: z.boolean().default(true),
});

/**
 * The enriched plugin manifest — consolidates ALL plugin metadata.
 */
export const PluginManifestSchema = z.object({
  /** Plugin package name (e.g., "openclaw-linear", "slack") */
  name: z.string(),
  /** Human-readable display name */
  displayName: z.string(),
  /** Whether to run `openclaw plugins install` during cloud-init */
  installable: z.boolean(),
  /** Whether this plugin needs Tailscale Funnel (public HTTPS for webhooks) */
  needsFunnel: z.boolean().default(false),
  /** Where this plugin's config lives in openclaw.json */
  configPath: z.enum(["plugins.entries", "channels"]),
  /** Secret definitions: configKey -> PluginSecret */
  secrets: z.record(PluginSecretSchema),
  /** Keys that are clawup-internal metadata and should NOT be written to OpenClaw config */
  internalKeys: z.array(z.string()).default([]),
  /** Default config values (lowest priority) */
  defaultConfig: z.record(z.unknown()).optional(),
  /** Config transforms to apply before writing to OpenClaw config */
  configTransforms: z.array(ConfigTransformSchema).default([]),
  /** Webhook setup configuration (for plugins that need incoming webhooks) */
  webhookSetup: WebhookSetupSchema.optional(),
}).superRefine((data, ctx) => {
  // Validate that webhookSetup.secretKey references an existing secret
  if (data.webhookSetup && !(data.webhookSetup.secretKey in data.secrets)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["webhookSetup", "secretKey"],
      message: `webhookSetup.secretKey "${data.webhookSetup.secretKey}" does not exist in secrets`,
    });
  }
});
