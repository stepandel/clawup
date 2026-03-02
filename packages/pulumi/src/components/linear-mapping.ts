/**
 * Pure helper for building the Linear plugin `agentMapping` config.
 *
 * Extracted from the Pulumi stack so it can be unit-tested without the
 * Pulumi runtime.
 */

export interface LinearMappingInput {
  /** UUID from inline plugin config (mergedConfig.linearUserUuid) */
  configUuid?: string;
  /** UUID from Pulumi config ({role}LinearUserUuid), used as fallback */
  pulumiConfigUuid?: string;
  /** agent.displayName (always present on ResolvedAgent) */
  agentDisplayName: string;
  /** identityResult?.manifest.displayName */
  identityDisplayName?: string;
  /** agent.name (raw name, last-resort fallback) */
  agentName: string;
}

/**
 * Build the `agentMapping` record for the Linear plugin.
 *
 * The mapping lets OpenClaw's Linear integration route issues to the
 * correct agent queue by matching either the Linear user UUID or the
 * human-readable agent display name.
 */
export function buildLinearAgentMapping(input: LinearMappingInput): Record<string, string> {
  const uuid = input.configUuid ?? input.pulumiConfigUuid ?? undefined;
  const label = input.agentDisplayName || input.identityDisplayName || input.agentName;

  const mapping: Record<string, string> = {};
  if (uuid) mapping[uuid] = "default";
  mapping[label] = "default";
  return mapping;
}
