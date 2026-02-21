/**
 * Re-export all constants from @clawup/core for backward compatibility.
 * External consumers importing "clawup/lib/constants" will get these.
 */
export {
  AGENT_ALIASES,
  AWS_REGIONS,
  BUILT_IN_IDENTITIES,
  CONFIG_DIR,
  COST_ESTIMATES,
  HETZNER_COST_ESTIMATES,
  HETZNER_LOCATIONS,
  HETZNER_SERVER_TYPES_EU,
  HETZNER_SERVER_TYPES_US,
  HETZNER_US_LOCATIONS,
  INSTANCE_TYPES,
  KEY_INSTRUCTIONS,
  MANIFEST_FILE,
  MODEL_PROVIDERS,
  PLUGINS_DIR,
  PROVIDERS,
  SSH_USER,
  hetznerServerTypes,
  slackAppManifest,
  tailscaleHostname,
} from "@clawup/core";
