export const CUSTOM_YAML_SNIPPET = `name: ops-monitor
displayName: Sentinel
role: infrastructure-monitor
emoji: satellite
model: anthropic/claude-sonnet-4-5

deps:
  - brave-search

plugins:
  - slack
  - pagerduty

skills:
  - healthcheck
  - incident-response

templateVars:
  - OWNER_NAME
  - ESCALATION_CHANNEL`;

export const CONFIG_YAML_SNIPPET = `stack: my-team
cloud: hetzner
region: nbg1
instanceType: cpx31

owner:
  name: Jordan
  timezone: America/New_York
  workingHours: "09:00-17:00"

agents:
  - identity: juno    # PM — preps tickets, assigns work
  - identity: titus   # Engineer — implements, opens PRs
  - identity: scout   # QA — reviews PRs, auto-fixes`;

export const WORKSPACE_FILES = [
  { file: "SOUL.md", description: "Personality, values, behavioral guidelines" },
  { file: "IDENTITY.md", description: "Name, role, emoji, display metadata" },
  { file: "HEARTBEAT.md", description: "Recurring checks and autonomous task loops" },
  { file: "TOOLS.md", description: "Tool permissions and usage patterns" },
];
