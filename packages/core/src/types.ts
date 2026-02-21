/**
 * Shared type definitions for Clawup.
 * Types are derived from Zod schemas — the schemas are the source of truth.
 */

import type { z } from "zod";
import type {
  AgentDefinitionSchema,
  ClawupManifestSchema,
  PluginConfigFileSchema,
  IdentityManifestSchema,
} from "./schemas";

/** Definition of a single agent in the manifest */
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/** Per-plugin configuration file stored at ~/.clawup/configs/<stack>/plugins/<plugin>.yaml */
export type PluginConfigFile = z.infer<typeof PluginConfigFileSchema>;

/** The clawup.yaml manifest */
export type ClawupManifest = z.infer<typeof ClawupManifestSchema>;

/** Manifest schema for an agent identity (identity.yaml) */
export type IdentityManifest = z.infer<typeof IdentityManifestSchema>;

/**
 * Result returned by fetchIdentity().
 * Contains the parsed manifest and all workspace/skill files from the identity directory.
 */
export interface IdentityResult {
  /** Parsed identity manifest (identity.yaml) */
  manifest: IdentityManifest;
  /** Files keyed by relative path (e.g., "SOUL.md", "skills/pm-queue-handler/SKILL.md") */
  files: Record<string, string>;
}

/**
 * Validate an AgentDefinition for consistency.
 *
 * @throws Error with descriptive message if validation fails
 */
export function validateAgentDefinition(agent: AgentDefinition): void {
  if (!agent.name) {
    throw new Error(`Agent definition missing required field "name".`);
  }

  if (!agent.displayName) {
    throw new Error(`Agent "${agent.name}" missing required field "displayName".`);
  }

  if (!agent.role) {
    throw new Error(`Agent "${agent.name}" missing required field "role".`);
  }

  if (!agent.identity) {
    throw new Error(`Agent "${agent.name}" missing required field "identity".`);
  }

  if (typeof agent.volumeSize !== "number" || agent.volumeSize <= 0) {
    throw new Error(`Agent "${agent.name}": "volumeSize" must be a positive number.`);
  }
}

/** Result of a single prerequisite check */
export interface PrereqResult {
  name: string;
  ok: boolean;
  message: string;
  hint?: string;
}

/**
 * Discriminated union for fallible operations that don't return a value.
 * Use instead of `{ ok: boolean; error?: string }` for proper type narrowing.
 */
export type VoidResult = { ok: true } | { ok: false; error: string };

/**
 * Discriminated union for fallible operations that return a value on success.
 * After narrowing with `if (result.ok)`, `result.value` is typed as `T`.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
