/**
 * CLI type definitions for Agent Army
 */

/** Definition of a single agent in the manifest */
export interface AgentDefinition {
  /** Resource name (e.g., "agent-pm") */
  name: string;
  /** Display name (e.g., "Juno") */
  displayName: string;
  /** Role identifier (e.g., "pm", "eng", "tester") */
  role: string;
  /** Preset name if using a preset, null for custom agents. Mutually exclusive with `identity`. */
  preset: string | null;
  /**
   * Git URL or local path to an identity repo/folder.
   * Supports `repo#subfolder` syntax for mono-repos.
   * Mutually exclusive with `preset`.
   */
  identity?: string;
  /** Pin the identity to a specific Git tag or commit hash */
  identityVersion?: string;
  /** EBS volume size in GB */
  volumeSize: number;
  /** Override instance type for this agent */
  instanceType?: string;
  /**
   * Custom SOUL.md content (custom agents only).
   * @deprecated Use an identity repo with a SOUL.md file instead.
   */
  soulContent?: string;
  /**
   * Custom IDENTITY.md content (custom agents only).
   * @deprecated Use an identity repo with an IDENTITY.md file instead.
   */
  identityContent?: string;
  /** Additional environment variables */
  envVars?: Record<string, string>;
  /** Plugin names to install on this agent (e.g., ["openclaw-linear"]) */
  plugins?: string[];
  /** Dep names for this agent (e.g., ["gh", "brave-search"]) */
  deps?: string[];
}

/** Per-plugin configuration file stored at ~/.agent-army/configs/<stack>/plugins/<plugin>.yaml */
export interface PluginConfigFile {
  agents: Record<string, Record<string, unknown>>;
}

/** The agent-army.yaml manifest */
export interface ArmyManifest {
  stackName: string;
  provider: "aws" | "hetzner";
  region: string;
  instanceType: string;
  ownerName: string;
  /** Owner timezone (e.g., "America/New_York") */
  timezone?: string;
  /** Owner working hours (e.g., "9am-6pm") */
  workingHours?: string;
  /** Additional notes about the owner for agents */
  userNotes?: string;
  /** Default Linear team identifier for bootstrap integration checks (e.g., "AGE") */
  linearTeam?: string;
  /** GitHub repo URL for bootstrap integration checks */
  githubRepo?: string;
  agents: AgentDefinition[];
}

/**
 * Manifest schema for an agent identity (identity.yaml).
 * Defines the agent's persona, defaults, bundled skills, and template variables.
 */
export interface IdentityManifest {
  /** Machine-readable identity name (e.g., "juno", "titus") */
  name: string;
  /** Human-readable display name (e.g., "Juno", "Titus") */
  displayName: string;
  /** Role identifier (e.g., "pm", "eng", "tester") */
  role: string;
  /** Emoji for the agent (GitHub shortcode, e.g., "clipboard") */
  emoji: string;
  /** Short description of the agent's purpose */
  description: string;
  /** Default EBS volume size in GB */
  volumeSize: number;
  /** Optional default instance type override */
  instanceType?: string;
  /**
   * List of skill identifiers for this identity.
   * Plain names (e.g., "pm-queue-handler") are private skills from the skills/ directory.
   * Prefixed names (e.g., "clawhub:my-skill") are public skills installed via clawhub.
   */
  skills: string[];
  /** Recommended plugins for this identity (e.g., ["openclaw-linear"]) */
  plugins?: string[];
  /** Recommended deps for this identity (e.g., ["gh", "brave-search"]) */
  deps?: string[];
  /** Per-plugin default config (merged with user plugin config at deploy time) */
  pluginDefaults?: Record<string, Record<string, unknown>>;
  /** List of template variable names this identity uses (e.g., ["OWNER_NAME", "TIMEZONE"]) */
  templateVars: string[];
}

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
 * Checks mutual exclusivity of `preset` and `identity`, and required fields.
 *
 * @throws Error with descriptive message if validation fails
 */
export function validateAgentDefinition(agent: AgentDefinition): void {
  // Validate required fields first so error messages below can reference agent.name safely
  if (!agent.name) {
    throw new Error(`Agent definition missing required field "name".`);
  }

  if (!agent.displayName) {
    throw new Error(`Agent "${agent.name}" missing required field "displayName".`);
  }

  if (!agent.role) {
    throw new Error(`Agent "${agent.name}" missing required field "role".`);
  }

  if (typeof agent.volumeSize !== "number" || agent.volumeSize <= 0) {
    throw new Error(`Agent "${agent.name}": "volumeSize" must be a positive number.`);
  }

  if (agent.preset && agent.identity) {
    throw new Error(
      `Agent "${agent.name}": "preset" and "identity" are mutually exclusive. Use one or the other.`
    );
  }

  if (!agent.preset && !agent.identity && !agent.soulContent) {
    throw new Error(
      `Agent "${agent.name}": must specify either "preset", "identity", or custom content ("soulContent").`
    );
  }

  if (agent.identityVersion && !agent.identity) {
    throw new Error(
      `Agent "${agent.name}": "identityVersion" requires "identity" to be set.`
    );
  }

  if (agent.plugins !== undefined) {
    if (!Array.isArray(agent.plugins)) {
      throw new Error(`Agent "${agent.name}": "plugins" must be an array of strings.`);
    }
    for (const p of agent.plugins) {
      if (typeof p !== "string" || !p) {
        throw new Error(`Agent "${agent.name}": each plugin must be a non-empty string.`);
      }
    }
  }
}

/** Result of a single prerequisite check */
export interface PrereqResult {
  name: string;
  ok: boolean;
  message: string;
  hint?: string;
}
