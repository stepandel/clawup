/**
 * Manifest resolver — hydrates minimal agent entries from their identities.
 *
 * Agent entries in clawup.yaml can be as minimal as `{ identity: "./pm" }`.
 * This module fills in name, displayName, role, and volumeSize from the
 * identity manifest, with explicit manifest values taking precedence.
 */

import { fetchIdentitySync } from "./identity";
import type { AgentDefinition, ClawupManifest, ResolvedAgent, ResolvedManifest } from "./types";

/**
 * Resolve a single agent entry by hydrating missing fields from its identity.
 * Manifest entry fields win over identity defaults (user overrides).
 */
export function resolveAgentSync(entry: AgentDefinition, cacheDir: string): ResolvedAgent {
  const identity = fetchIdentitySync(entry.identity, cacheDir);
  return {
    ...entry,
    name: entry.name ?? `agent-${identity.manifest.name}`,
    displayName: entry.displayName ?? identity.manifest.displayName,
    role: entry.role ?? identity.manifest.role,
    volumeSize: entry.volumeSize ?? identity.manifest.volumeSize ?? 30,
  };
}

/**
 * Resolve all agents in a manifest, hydrating missing fields from identities.
 */
export function resolveManifestSync(manifest: ClawupManifest, cacheDir: string): ResolvedManifest {
  return {
    ...manifest,
    agents: manifest.agents.map((entry) => resolveAgentSync(entry, cacheDir)),
  };
}
