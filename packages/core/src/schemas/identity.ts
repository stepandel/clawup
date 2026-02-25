/**
 * Zod schema for identity.yaml manifests.
 * Source of truth — the IdentityManifest type is derived via z.infer<>.
 */

import { z } from "zod";

/** Schema for an agent identity manifest (identity.yaml) */
export const IdentityManifestSchema = z.object({
  /** Machine-readable identity name (e.g., "juno", "titus") */
  name: z.string().min(1, '"name" must be a non-empty string'),
  /** Human-readable display name (e.g., "Juno", "Titus") */
  displayName: z.string().min(1, '"displayName" must be a non-empty string'),
  /** Role identifier (e.g., "pm", "eng", "tester") */
  role: z.string().min(1, '"role" must be a non-empty string'),
  /** Emoji for the agent (GitHub shortcode, e.g., "clipboard") */
  emoji: z.string().min(1, '"emoji" must be a non-empty string'),
  /** Short description of the agent's purpose */
  description: z.string().min(1, '"description" must be a non-empty string'),
  /** Default EBS volume size in GB */
  volumeSize: z.number({ invalid_type_error: '"volumeSize" must be a number' }).positive(),
  /** Optional default instance type override */
  instanceType: z.string().optional(),
  /**
   * List of skill identifiers for this identity.
   * Plain names are private skills; "clawhub:" prefixed are public.
   */
  skills: z.array(z.string(), { invalid_type_error: '"skills" must be an array' }),
  /** Recommended plugins for this identity (e.g., ["openclaw-linear"]) */
  plugins: z.array(
    z.string().min(1, "each plugin must be a non-empty string"),
    { invalid_type_error: '"plugins" must be an array of strings' },
  ).optional(),
  /** Recommended deps for this identity (e.g., ["gh", "brave-search"]) */
  deps: z.array(z.string()).optional(),
  /** Per-plugin default config (merged with user plugin config at deploy time) */
  pluginDefaults: z.record(
    z.string(),
    z.record(z.string(), z.unknown()),
  ).optional(),
  /** List of template variable names this identity uses */
  templateVars: z.array(z.string(), { invalid_type_error: '"templateVars" must be an array' }),
  /** Default AI model for this identity (e.g., "anthropic/claude-opus-4-6") */
  model: z.string().optional(),
  /** Backup/fallback model (e.g., "anthropic/claude-sonnet-4-5") */
  backupModel: z.string().optional(),
  /** Coding agent CLI to use (e.g., "claude-code", "codex", "amp"). Defaults to "claude-code". */
  codingAgent: z.string().optional(),
  /** Additional secret keys this identity requires beyond what plugins/deps imply */
  requiredSecrets: z.array(
    z.string().min(1, "each requiredSecrets entry must be a non-empty string"),
    { invalid_type_error: '"requiredSecrets" must be an array of strings' },
  ).optional(),
});
