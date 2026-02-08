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

/**
 * Build the Tailscale hostname for an agent.
 * Includes the stack name to avoid conflicts across deployments.
 * Example: "dev-agent-pm", "prod-agent-eng"
 */
export function tailscaleHostname(stackName: string, agentName: string): string {
  return `${stackName}-${agentName}`;
}

/** Key instructions for onboarding prompts */
export const KEY_INSTRUCTIONS = {
  anthropicApiKey: {
    title: "Anthropic API Key",
    steps: [
      "To get your Anthropic API key:",
      "1. Go to https://console.anthropic.com/account/keys",
      "2. Click \"Create Key\"",
      "3. Copy the key (starts with sk-ant-)",
    ],
  },
  tailscaleAuthKey: {
    title: "Tailscale Auth Key",
    steps: [
      "To get your Tailscale auth key:",
      "1. Go to https://login.tailscale.com/admin/settings/keys",
      "2. Click \"Generate auth key\"",
      "3. Enable \"Reusable\" AND \"Ephemeral\" — ephemeral nodes auto-remove when offline",
      "4. Copy the key (starts with tskey-auth-)",
    ],
  },
  tailscaleApiKey: {
    title: "Tailscale API Key (optional)",
    steps: [
      "For reliable cleanup of Tailscale devices during destroy:",
      "1. Go to https://login.tailscale.com/admin/settings/keys",
      "2. Under \"API access tokens\", click \"Generate access token\"",
      "3. Copy the key (starts with tskey-api-)",
      "4. This is optional but recommended for clean teardowns",
    ],
  },
  tailnetDnsName: {
    title: "Tailnet DNS Name",
    steps: [
      "To find your Tailnet DNS name:",
      "1. Go to https://login.tailscale.com/admin/dns",
      "2. Look for your tailnet name at the top",
      "3. It looks like \"tailXXXXX.ts.net\" or a custom domain",
    ],
  },
  slackCredentials: {
    title: "Slack App Credentials",
    steps: [
      "To get Slack Bot and App tokens:",
      "1. Go to https://api.slack.com/apps and create a new app",
      "2. Enable Socket Mode — copy the App-Level Token (xapp-...)",
      "3. Under \"OAuth & Permissions\", add scopes: chat:write, channels:history, channels:read",
      "4. Install the app to your workspace — copy the Bot Token (xoxb-...)",
      "5. Create a separate Slack app for each agent",
    ],
  },
  linearApiKey: {
    title: "Linear API Key",
    steps: [
      "Create a separate Linear account for each agent:",
      "1. Sign up at https://linear.app with you+agentname@domain.com",
      "   (plus-addressing forwards to your inbox — no new email needed)",
      "2. Go to Settings → API → \"Create key\"",
      "3. Copy the key (starts with lin_api_)",
    ],
  },
  braveSearchApiKey: {
    title: "Brave Search API Key",
    steps: [
      "To get a Brave Search API key:",
      "1. Go to https://brave.com/search/api/",
      "2. Sign up for the free plan (2,000 queries/month)",
      "3. Copy the API key (starts with BSA)",
    ],
  },
} as const;
