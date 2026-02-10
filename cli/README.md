# Agent Army CLI

[![npm](https://img.shields.io/npm/v/agent-army)](https://www.npmjs.com/package/agent-army)

Interactive command-line tool for deploying and managing your fleet of [OpenClaw](https://openclaw.bot/) AI agents on **AWS** or **Hetzner Cloud**.

## Installation

```bash
# Global install
npm install -g agent-army

# Or run directly
npx agent-army init
```

## Commands

### `agent-army init`

Interactive setup wizard that walks you through the full configuration:

1. **Prerequisites check** — verifies Pulumi CLI, Node.js, cloud provider CLI, and Tailscale are installed
2. **Cloud provider** — AWS or Hetzner Cloud
3. **Region & instance type** — with cost estimates shown inline
4. **Secrets** — Anthropic API key, Tailscale auth key (with inline instructions for each)
5. **Agent selection** — choose from presets, define custom agents, or mix both
6. **Optional integrations** — Slack, Linear, GitHub per agent
7. **Summary & confirmation** — review config and estimated cost before proceeding

Outputs an `agent-army.json` manifest and sets all Pulumi config values.

```bash
agent-army init              # Interactive wizard
agent-army init --deploy     # Deploy immediately after setup
agent-army init --deploy -y  # Deploy without confirmation
```

### `agent-army deploy`

Deploy your agents with `pulumi up`. Runs prerequisite checks before deploying.

```bash
agent-army deploy             # Deploy with confirmation prompt
agent-army deploy -y          # Skip confirmation
agent-army deploy -c staging  # Deploy a specific config
```

### `agent-army status`

Show agent statuses from Pulumi stack outputs.

```bash
agent-army status             # Pretty-printed output
agent-army status --json      # JSON output
agent-army status -c staging  # Status for a specific config
```

### `agent-army ssh <agent>`

SSH to an agent by name, role, or alias. Resolves agents flexibly — all of these work:

```bash
agent-army ssh juno        # By alias
agent-army ssh pm          # By role
agent-army ssh agent-pm    # By resource name
```

Run a command on the agent instead of opening an interactive session:

```bash
agent-army ssh juno 'openclaw gateway status'
```

Options:

| Flag | Description |
|------|-------------|
| `-u, --user <user>` | SSH user (default: `ubuntu`) |
| `-c, --config <name>` | Config name (auto-detected if only one) |

### `agent-army validate`

Health check all agents via Tailscale SSH.

```bash
agent-army validate            # Default 30-second timeout
agent-army validate -t 60      # 60-second timeout
agent-army validate -c staging # Validate a specific config
```

### `agent-army destroy`

Tear down all resources with safety confirmations.

```bash
agent-army destroy             # With confirmation prompts
agent-army destroy -y          # Skip confirmations (dangerous!)
agent-army destroy -c staging  # Destroy a specific config
```

### `agent-army list`

List all saved configurations.

```bash
agent-army list          # Pretty-printed output
agent-army list --json   # JSON output
```

## Preset Agents

The CLI ships with three preset agent configurations:

| Alias | Role | Name | Description |
|-------|------|------|-------------|
| **Juno** | PM | `agent-pm` | Break down tickets, research, plan and sequence work, track progress, unblock teams |
| **Titus** | Engineer | `agent-eng` | Lead engineering, coding, shipping |
| **Scout** | Tester | `agent-tester` | Quality assurance, verification, bug hunting |

You can also define fully custom agents during `init`.

## Configuration

### `agent-army.json`

The `init` command generates an `agent-army.json` manifest in the project root:

```json
{
  "stackName": "dev",
  "provider": "aws",
  "region": "us-east-1",
  "instanceType": "t3.medium",
  "ownerName": "Your Name",
  "agents": [
    {
      "name": "agent-pm",
      "displayName": "Juno",
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
- `aws:region` (AWS) or `hcloud:token` (Hetzner)
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
│   ├── destroy.ts      # Tear down resources
│   └── list.ts         # List saved configs
├── lib/
│   ├── config.ts       # Load/save agent-army.json manifest
│   ├── constants.ts    # Presets, aliases, regions, instance types, cost estimates
│   ├── exec.ts         # Shell command execution
│   ├── prerequisites.ts # Prerequisite checks
│   ├── process.ts      # Graceful shutdown handling
│   ├── pulumi.ts       # Pulumi stack & config operations
│   ├── tailscale.ts    # Tailscale device management
│   └── ui.ts           # UI helpers (banners, spinners, formatting)
├── adapters/
│   ├── cli-adapter.ts  # CLI adapter for interactive commands
│   ├── api-adapter.ts  # API adapter for programmatic use
│   └── types.ts        # Adapter type definitions
└── tools/
    ├── deploy.ts       # Deploy tool logic
    ├── destroy.ts      # Destroy tool logic
    ├── status.ts       # Status tool logic
    └── validate.ts     # Validate tool logic
```

## Dependencies

- [Commander.js](https://github.com/tj/commander.js) — CLI argument parsing
- [@clack/prompts](https://github.com/natemoo-re/clack) — Interactive terminal prompts
- [picocolors](https://github.com/alexeyraspopov/picocolors) — Terminal colors
