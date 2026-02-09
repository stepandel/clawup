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
    displayName: "Titus",
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
  titus: "eng",
  scout: "tester",
};

/** Available cloud providers */
export const PROVIDERS = [
  { value: "aws", label: "AWS", hint: "Amazon Web Services EC2 instances" },
  { value: "hetzner", label: "Hetzner", hint: "Hetzner Cloud servers (EU/US)" },
] as const;

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

/** Hetzner Cloud locations */
export const HETZNER_LOCATIONS = [
  { value: "fsn1", label: "Falkenstein, DE (fsn1)" },
  { value: "nbg1", label: "Nuremberg, DE (nbg1)" },
  { value: "hel1", label: "Helsinki, FI (hel1)" },
  { value: "ash", label: "Ashburn, US (ash)" },
];

/** Instance type options (AWS) */
export const INSTANCE_TYPES = [
  { value: "t3.small", label: "t3.small — 2 vCPU, 2 GB (~$15/mo)" },
  { value: "t3.medium", label: "t3.medium — 2 vCPU, 4 GB (~$30/mo)" },
  { value: "t3.large", label: "t3.large — 2 vCPU, 8 GB (~$60/mo)" },
];

/** Hetzner server types */
export const HETZNER_SERVER_TYPES = [
  { value: "cx22", label: "cx22 — 2 vCPU, 4 GB (~$4/mo)" },
  { value: "cx32", label: "cx32 — 4 vCPU, 8 GB (~$7/mo)" },
  { value: "cx42", label: "cx42 — 8 vCPU, 16 GB (~$14/mo)" },
];

/** Default SSH user for agent instances (Ubuntu 24.04 AMI default) */
export const SSH_USER = "ubuntu";

/** Estimated monthly cost per instance type (AWS) */
export const COST_ESTIMATES: Record<string, number> = {
  "t3.small": 15,
  "t3.medium": 30,
  "t3.large": 60,
};

/** Estimated monthly cost per server type (Hetzner) */
export const HETZNER_COST_ESTIMATES: Record<string, number> = {
  cx22: 4,
  cx32: 7,
  cx42: 14,
};

/** Coding CLI definitions */
export interface CodingCliDef {
  displayName: string;
  description: string;
  binaryPath: string;
  installMethod: "pip" | "npm" | "binary";
}

export const CODING_CLIS: Record<string, CodingCliDef> = {
  "claude-code": {
    displayName: "Claude Code",
    description: "Anthropic's official CLI for Claude",
    binaryPath: "$HOME/.local/bin/claude",
    installMethod: "pip",
  },
  codex: {
    displayName: "Codex",
    description: "OpenAI's Codex CLI",
    binaryPath: "codex",
    installMethod: "npm",
  },
  amp: {
    displayName: "Amp",
    description: "Sourcegraph's Amp CLI",
    binaryPath: "amp",
    installMethod: "npm",
  },
  opencode: {
    displayName: "OpenCode",
    description: "Open-source coding assistant CLI",
    binaryPath: "opencode",
    installMethod: "npm",
  },
};

/** Manifest filename */
export const MANIFEST_FILE = "agent-army.json";

/** Config directory under home (~/.agent-army/configs/) */
export const CONFIG_DIR = ".agent-army/configs";

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
    title: "Slack App Setup",
    steps: [
      "Create a Slack app for each agent using the manifest shown below:",
      "1. Go to https://api.slack.com/apps → \"Create New App\" → \"From a manifest\"",
      "2. Select your workspace, paste the JSON manifest, and create the app",
      "3. Go to \"OAuth & Permissions\" — copy the Bot Token (xoxb-...)",
      "4. Under \"Basic Information\" → \"App-Level Tokens\", generate a token",
      "   with the connections:write scope — copy it (xapp-...)",
    ],
  },
  linearApiKey: {
    title: "Linear API Key",
    steps: [
      "Create a separate Linear account for each agent:",
      "1. Invite you+agentname@domain.com to your Linear workspace",
      "   (plus-addressing forwards to your inbox — no new email needed)",
      "   Follow the link in the invite email to create the account and join the org",
      "2. Go to Settings → Security & Access → Personal API keys → \"New API key\"",
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
  githubToken: {
    title: "GitHub Token (optional)",
    steps: [
      "To get a GitHub personal access token for gh CLI:",
      "1. Go to https://github.com/settings/tokens?type=beta",
      "2. Click \"Generate new token\" → Fine-grained token",
      "3. Select repositories, set expiration, and permissions (e.g., repo, read:org)",
      "4. Copy the token (starts with github_pat_ or ghp_)",
      "5. Press Enter to skip if not needed",
    ],
  },
} as const;

/** Generate a Slack app manifest JSON for a given agent */
export function slackAppManifest(agentName: string): string {
  return JSON.stringify({
    display_information: {
      name: agentName,
      description: "Slack connector for OpenClaw",
    },
    features: {
      bot_user: {
        display_name: agentName,
        always_online: false,
      },
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      slash_commands: [
        {
          command: "/openclaw",
          description: "Send a message to OpenClaw",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          "chat:write",
          "channels:history",
          "channels:read",
          "groups:history",
          "groups:read",
          "groups:write",
          "im:history",
          "im:read",
          "im:write",
          "mpim:history",
          "mpim:read",
          "mpim:write",
          "users:read",
          "app_mentions:read",
          "reactions:read",
          "reactions:write",
          "pins:read",
          "pins:write",
          "emoji:read",
          "commands",
          "files:read",
          "files:write",
        ],
        user: [
          "channels:history",
          "channels:read",
          "groups:history",
          "groups:read",
          "im:history",
          "im:read",
          "mpim:history",
          "mpim:read",
          "users:read",
          "reactions:read",
          "pins:read",
          "emoji:read",
          "search:read",
        ],
      },
    },
    settings: {
      socket_mode_enabled: true,
      event_subscriptions: {
        bot_events: [
          "app_mention",
          "message.channels",
          "message.groups",
          "message.im",
          "message.mpim",
          "reaction_added",
          "reaction_removed",
          "member_joined_channel",
          "member_left_channel",
          "channel_rename",
          "pin_added",
          "pin_removed",
        ],
      },
    },
  }, null, 2);
}
