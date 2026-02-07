/**
 * Constants, preset definitions, aliases, and defaults
 */

/** Available preset agents */
export const PRESETS = {
  pm: {
    name: "agent-pm",
    displayName: "Sage",
    role: "pm",
    preset: "pm" as const,
    volumeSize: 30,
    description: "Project management, coordination, communication",
  },
  eng: {
    name: "agent-eng",
    displayName: "Atlas",
    role: "eng",
    preset: "eng" as const,
    volumeSize: 50,
    description: "Lead engineering, coding, shipping",
  },
  tester: {
    name: "agent-tester",
    displayName: "Scout",
    role: "tester",
    preset: "tester" as const,
    volumeSize: 30,
    description: "Quality assurance, verification, bug hunting",
  },
} as const;

/** Map agent aliases to role keys */
export const AGENT_ALIASES: Record<string, string> = {
  sage: "pm",
  atlas: "eng",
  scout: "tester",
};

/** Common AWS regions for selection */
export const AWS_REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "eu-west-1", label: "EU (Ireland)" },
  { value: "eu-central-1", label: "EU (Frankfurt)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
];

/** Instance type options */
export const INSTANCE_TYPES = [
  { value: "t3.small", label: "t3.small — 2 vCPU, 2 GB (~$15/mo)" },
  { value: "t3.medium", label: "t3.medium — 2 vCPU, 4 GB (~$30/mo)" },
  { value: "t3.large", label: "t3.large — 2 vCPU, 8 GB (~$60/mo)" },
];

/** Default SSH user for agent instances (Ubuntu 24.04 AMI default) */
export const SSH_USER = "ubuntu";

/** Estimated monthly cost per instance type */
export const COST_ESTIMATES: Record<string, number> = {
  "t3.small": 15,
  "t3.medium": 30,
  "t3.large": 60,
};

/** Manifest filename */
export const MANIFEST_FILE = "agent-army.json";
