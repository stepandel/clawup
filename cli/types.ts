/**
 * CLI type definitions for Agent Army
 */

/** Definition of a single agent in the manifest */
export interface AgentDefinition {
  /** Resource name (e.g., "agent-pm") */
  name: string;
  /** Display name (e.g., "Sage") */
  displayName: string;
  /** Role identifier (e.g., "pm", "eng", "tester") */
  role: string;
  /** Preset name if using a preset, null for custom agents */
  preset: string | null;
  /** EBS volume size in GB */
  volumeSize: number;
  /** Override instance type for this agent */
  instanceType?: string;
  /** Custom SOUL.md content (custom agents only) */
  soulContent?: string;
  /** Custom IDENTITY.md content (custom agents only) */
  identityContent?: string;
  /** Additional environment variables */
  envVars?: Record<string, string>;
}

/** The agent-army.json manifest */
export interface ArmyManifest {
  stackName: string;
  region: string;
  instanceType: string;
  ownerName: string;
  agents: AgentDefinition[];
  /** Coding CLIs to install (default: ["claude-code"]) */
  codingClis?: string[];
}

/** Result of a single prerequisite check */
export interface PrereqResult {
  name: string;
  ok: boolean;
  message: string;
  hint?: string;
}
