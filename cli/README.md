# Agent Army CLI

Interactive command-line tool for deploying and managing your fleet of [OpenClaw](https://openclaw.bot/) AI agents on AWS.

## Installation

```bash
# Global install
npm install -g @agent-army/cli

# Or run directly
npx @agent-army/cli init
```

## Commands

### `agent-army init`

Interactive setup wizard that walks you through the full configuration:

1. **Prerequisites check** — verifies Pulumi CLI, Node.js, AWS CLI, and Tailscale are installed
2. **Stack configuration** — stack name, AWS region, instance type, owner name
3. **Secrets** — Anthropic API key, Tailscale auth key, tailnet DNS name (with inline instructions for obtaining each)
4. **Agent selection** — choose from presets, define custom agents, or mix both
5. **Summary & confirmation** — review config and estimated cost before proceeding

Outputs an `agent-army.json` manifest and sets all Pulumi config values.

### `agent-army deploy`

Deploy your agents with `pulumi up`. Runs prerequisite checks before deploying.

```bash
agent-army deploy          # Deploy with confirmation prompt
agent-army deploy -y       # Skip confirmation
```

### `agent-army status`

Show agent statuses from Pulumi stack outputs.

```bash
agent-army status          # Pretty-printed output
agent-army status --json   # JSON output
```

### `agent-army ssh <agent>`

SSH to an agent by name, role, or alias. Resolves agents flexibly — all of these work:

```bash
agent-army ssh sage        # By alias
agent-army ssh pm          # By role
agent-army ssh agent-pm    # By resource name
```

Run a command on the agent instead of opening an interactive session:

```bash
agent-army ssh sage 'openclaw gateway status'
```

Options:

| Flag | Description |
|------|-------------|
| `-u, --user <user>` | SSH user (default: `ubuntu`) |

### `agent-army validate`

Health check all agents via Tailscale SSH.

```bash
agent-army validate
agent-army validate -t 60   # 60-second timeout
```

### `agent-army destroy`

Tear down all resources with safety confirmations.

```bash
agent-army destroy          # With confirmation prompts
agent-army destroy -y       # Skip confirmations (dangerous!)
```

## Preset Agents

The CLI ships with three preset agent configurations:

| Alias | Role | Name | Description |
|-------|------|------|-------------|
| **Marcus** | PM | `agent-pm` | Break down tickets, research, plan and sequence work, track progress, unblock teams |
| **Titus** | Engineer | `agent-eng` | Lead engineering, coding, shipping |
| **Scout** | Tester | `agent-tester` | Quality assurance, verification, bug hunting |

You can also define fully custom agents during `init`.

## Configuration

### `agent-army.json`

The `init` command generates an `agent-army.json` manifest in the project root:

```json
{
  "stackName": "dev",
  "region": "us-east-1",
  "instanceType": "t3.medium",
  "ownerName": "Boss",
  "agents": [
    {
      "name": "agent-pm",
      "displayName": "Marcus",
      "role": "pm",
      "preset": "pm",
      "volumeSize": 30
    }
  ]
}
```

This manifest is read by the Pulumi program at deploy time to dynamically create the agent stack.

### Pulumi Config

Secrets and stack configuration are stored in Pulumi config (encrypted). The `init` command sets these automatically:

- `anthropicApiKey` (secret)
- `tailscaleAuthKey` (secret)
- `tailnetDnsName`
- `aws:region`
- `instanceType`
- `ownerName`

## Project Structure

```
cli/
├── bin.ts              # Entry point (Commander.js program)
├── types.ts            # TypeScript type definitions
├── commands/
│   ├── init.ts         # Interactive setup wizard
│   ├── deploy.ts       # Deploy agents
│   ├── status.ts       # Show agent statuses
│   ├── ssh.ts          # SSH to agents
│   ├── validate.ts     # Health check agents
│   └── destroy.ts      # Tear down resources
└── lib/
    ├── config.ts       # Load/save agent-army.json manifest
    ├── constants.ts    # Presets, aliases, regions, instance types
    ├── exec.ts         # Shell command execution
    ├── prerequisites.ts # Prerequisite checks
    ├── pulumi.ts       # Pulumi stack & config operations
    └── ui.ts           # UI helpers (banners, spinners, formatting)
```

## Dependencies

- [Commander.js](https://github.com/tj/commander.js) — CLI argument parsing
- [@clack/prompts](https://github.com/natemoo-re/clack) — Interactive terminal prompts
- [picocolors](https://github.com/alexeyraspopov/picocolors) — Terminal colors
