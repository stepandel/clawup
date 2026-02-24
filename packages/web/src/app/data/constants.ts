export const CUSTOM_YAML_SNIPPET = `name: ops-monitor
displayName: Sentinel
role: infrastructure-monitor
emoji: satellite
description: Infrastructure monitoring and incident response
volumeSize: 20
model: anthropic/claude-sonnet-4-5

deps:
  - brave-search

plugins:
  - slack

skills:
  - healthcheck
  - incident-response

templateVars:
  - OWNER_NAME
  - ESCALATION_CHANNEL`;

export const CONFIG_YAML_SNIPPET = `stackName: my-team
provider: hetzner
region: nbg1
instanceType: cpx31
ownerName: Jordan
timezone: America/New_York
workingHours: "09:00-17:00"

agents:
  - name: agent-pm
    displayName: Juno
    role: pm
    identity: "github.com/myorg/identities#pm"
    volumeSize: 30
  - name: agent-eng
    displayName: Titus
    role: eng
    identity: "github.com/myorg/identities#eng"
    volumeSize: 50`;

export const WORKSPACE_FILES = [
  { file: "SOUL.md", description: "Personality, values, behavioral guidelines" },
  { file: "IDENTITY.md", description: "Name, role, emoji, display metadata" },
  { file: "HEARTBEAT.md", description: "Recurring checks and autonomous task loops" },
  { file: "TOOLS.md", description: "Tool permissions and usage patterns" },
];
