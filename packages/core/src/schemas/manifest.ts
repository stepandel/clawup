/**
 * Zod schemas for the agent-army.yaml manifest and agent definitions.
 * These are the source of truth — TypeScript types are derived via z.infer<>.
 */

import { z } from "zod";

/** Schema for a single agent in the manifest */
export const AgentDefinitionSchema = z.object({
  /** Resource name (e.g., "agent-pm") */
  name: z.string().min(1, "Agent name is required"),
  /** Display name (e.g., "Juno") */
  displayName: z.string().min(1, "Agent displayName is required"),
  /** Role identifier (e.g., "pm", "eng", "tester") */
  role: z.string().min(1, "Agent role is required"),
  /**
   * Git URL or local path to an identity repo/folder.
   * Supports `repo#subfolder` syntax for mono-repos.
   */
  identity: z.string().min(1, "Agent identity is required"),
  /** Pin the identity to a specific Git tag or commit hash */
  identityVersion: z.string().optional(),
  /** EBS volume size in GB */
  volumeSize: z.number().positive("volumeSize must be a positive number"),
  /** Override instance type for this agent */
  instanceType: z.string().optional(),
  /** Additional environment variables */
  envVars: z.record(z.string(), z.string()).optional(),
  /** Inline plugin config (non-secret values only) */
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

/** Schema for per-plugin configuration file */
export const PluginConfigFileSchema = z.object({
  agents: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** Schema for the agent-army.yaml manifest */
export const ArmyManifestSchema = z.object({
  stackName: z.string().min(1, "stackName is required"),
  provider: z.enum(["aws", "hetzner"]),
  region: z.string().min(1, "region is required"),
  instanceType: z.string().min(1, "instanceType is required"),
  ownerName: z.string().min(1, "ownerName is required"),
  /** Owner timezone (e.g., "America/New_York") */
  timezone: z.string().optional(),
  /** Owner working hours (e.g., "9am-6pm") */
  workingHours: z.string().optional(),
  /** Additional notes about the owner for agents */
  userNotes: z.string().optional(),
  /** Generic template variables (e.g., LINEAR_TEAM, GITHUB_REPO) */
  templateVars: z.record(z.string(), z.string()).optional(),
  agents: z.array(AgentDefinitionSchema).min(1, "At least one agent is required"),
});
