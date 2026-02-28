/**
 * Zod schemas for the clawup.yaml manifest and agent definitions.
 * These are the source of truth — TypeScript types are derived via z.infer<>.
 */

import { z } from "zod";

/** Schema for a single agent in the manifest */
export const AgentDefinitionSchema = z.object({
  /**
   * Git URL or local path to an identity repo/folder.
   * Supports `repo#subfolder` syntax for mono-repos.
   */
  identity: z.string().min(1, "Agent identity is required"),
  /** Resource name (e.g., "agent-pm"). Derived from identity if omitted. */
  name: z.string().optional(),
  /** Display name (e.g., "Juno"). Derived from identity if omitted. */
  displayName: z.string().optional(),
  /** Role identifier (e.g., "pm", "eng", "tester"). Derived from identity if omitted. */
  role: z.string().optional(),
  /** Pin the identity to a specific Git tag or commit hash */
  identityVersion: z.string().optional(),
  /** EBS volume size in GB. Derived from identity if omitted (default: 30). */
  volumeSize: z.number().positive("volumeSize must be a positive number").optional(),
  /** Override instance type for this agent */
  instanceType: z.string().optional(),
  /** Additional environment variables */
  envVars: z.record(z.string(), z.string()).optional(),
  /** Inline plugin config (non-secret values only) */
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  /** Per-agent secret references (e.g., `${env:PM_SLACK_BOT_TOKEN}`) */
  secrets: z.record(z.string(), z.string()).optional(),
});

/** Schema for per-plugin configuration file */
export const PluginConfigFileSchema = z.object({
  agents: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** Schema for the clawup.yaml manifest */
export const ClawupManifestSchema = z.object({
  stackName: z.string().min(1, "stackName is required"),
  /** Pulumi organization (e.g., "my-org"). When set, stack operations use org/stackName. */
  organization: z.string().optional(),
  provider: z.enum(["aws", "hetzner", "local"]),
  region: z.string().min(1, "region is required"),
  instanceType: z.string().min(1, "instanceType is required"),
  ownerName: z.string().min(1, "ownerName is required"),
  /** Owner timezone (e.g., "America/New_York") */
  timezone: z.string().optional(),
  /** Owner working hours (e.g., "9am-6pm") */
  workingHours: z.string().optional(),
  /** Additional notes about the owner for agents */
  userNotes: z.string().optional(),
  /** Model provider (e.g., "anthropic", "openai", "google", "openrouter") */
  modelProvider: z.string().optional(),
  /** Default model (e.g., "anthropic/claude-opus-4-6") */
  defaultModel: z.string().optional(),
  /** Generic template variables (e.g., LINEAR_TEAM, GITHUB_REPO) */
  templateVars: z.record(z.string(), z.string()).optional(),
  /** Global secret references (e.g., `${env:ANTHROPIC_API_KEY}`) */
  secrets: z.record(z.string(), z.string()).optional(),
  agents: z.array(AgentDefinitionSchema).min(1, "At least one agent is required"),
});
