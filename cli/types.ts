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
  /**
   * Git URL or local path to an identity repo/folder.
   * Supports `repo#subfolder` syntax for mono-repos.
   */
  identity: string;
  /** Pin the identity to a specific Git tag or commit hash */
  identityVersion?: string;
  /** EBS volume size in GB */
  volumeSize: number;
  /** Override instance type for this agent */
  instanceType?: string;
  /** Additional environment variables */
  envVars?: Record<string, string>;
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
  /** Generic template variables (e.g., LINEAR_TEAM, GITHUB_REPO) */
  templateVars?: Record<string, string>;
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
  /** Default AI model for this identity (e.g., "anthropic/claude-opus-4-6") */
  model?: string;
  /** Backup/fallback model (e.g., "anthropic/claude-sonnet-4-5") */
  backupModel?: string;
  /** Coding agent CLI to use (e.g., "claude-code", "codex", "amp"). Defaults to "claude-code". */
  codingAgent?: string;
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
