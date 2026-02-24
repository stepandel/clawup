# Clawup CLI

[![npm](https://img.shields.io/npm/v/clawup)](https://www.npmjs.com/package/clawup)

Interactive command-line tool for deploying and managing your fleet of [OpenClaw](https://openclaw.bot/) AI agents on **AWS** or **Hetzner Cloud**.

## Installation

```bash
# Global install
npm install -g clawup

# Or run directly
npx clawup init
```

## Commands

### `clawup init`

Interactive setup wizard that walks you through the full configuration:

1. **Prerequisites check** — verifies Pulumi CLI, Node.js, cloud provider CLI, and Tailscale are installed
2. **Cloud provider** — AWS or Hetzner Cloud
3. **Region & instance type** — with cost estimates shown inline
4. **Secrets** — Anthropic API key, Tailscale auth key (with inline instructions for each)
5. **Agent selection** — choose from presets, define custom agents, or mix both
6. **Optional integrations** — Slack, Linear, GitHub per agent
7. **Summary & confirmation** — review config and estimated cost before proceeding

Outputs a `clawup.yaml` manifest and sets all Pulumi config values.

```bash
clawup init              # Interactive wizard
clawup init --deploy     # Deploy immediately after setup
clawup init --deploy -y  # Deploy without confirmation
```

### `clawup deploy`

Deploy your agents with `pulumi up`. Runs prerequisite checks before deploying.

```bash
clawup deploy             # Deploy with confirmation prompt
clawup deploy -y          # Skip confirmation
```

### `clawup status`

Show agent statuses from Pulumi stack outputs.

```bash
clawup status             # Pretty-printed output
clawup status --json      # JSON output
```

### `clawup ssh <agent>`

SSH to an agent by name, role, or alias. Resolves agents flexibly — all of these work:

```bash
clawup ssh juno        # By alias
clawup ssh pm          # By role
clawup ssh agent-pm    # By resource name
```

Run a command on the agent instead of opening an interactive session:

```bash
clawup ssh juno 'openclaw gateway status'
```

Options:

| Flag | Description |
|------|-------------|
| `-u, --user <user>` | SSH user (default: `ubuntu`) |

### `clawup validate`

Health check all agents via Tailscale SSH.

```bash
clawup validate            # Default 30-second timeout
clawup validate -t 60      # 60-second timeout
```

### `clawup destroy`

Tear down all resources with safety confirmations.

```bash
clawup destroy             # With confirmation prompts
clawup destroy -y          # Skip confirmations (dangerous!)
```

### `clawup redeploy`

Update agents in-place without destroying infrastructure. Runs `pulumi up --refresh` to sync cloud state and apply changes. If the stack doesn't exist, falls back to a fresh deploy.

```bash
clawup redeploy             # With confirmation prompt
clawup redeploy -y          # Skip confirmation
```

### `clawup config show`

Display current configuration in a human-readable format.

```bash
clawup config show             # Pretty-printed output
clawup config show --json      # Full JSON output
```

### `clawup config set <key> <value>`

Update a config value with validation. No need to re-run `init`.

Top-level keys: `region`, `instanceType`, `ownerName`, `timezone`, `workingHours`, `userNotes`, `linearTeam`, `githubRepo`

Per-agent keys: `instanceType`, `volumeSize`, `displayName`

```bash
clawup config set region us-west-2
clawup config set instanceType t3.large
clawup config set instanceType cx32 -a titus   # Per-agent override
clawup config set volumeSize 50 -a scout       # Per-agent volume
```

### `clawup secrets set <key> <value>`

Set a Pulumi secret without re-running `init`. Useful for adding or rotating API keys post-setup.

Global keys: `anthropicApiKey`, `tailscaleAuthKey`, `tailscaleApiKey`, `tailnetDnsName`, `braveApiKey`

Per-agent keys (use `--agent`): `slackBotToken`, `slackAppToken`, `linearApiKey`, `linearWebhookSecret`, `linearUserUuid`, `githubToken`

```bash
clawup secrets set braveApiKey BSA_xxx
clawup secrets set slackBotToken xoxb-xxx --agent eng
clawup secrets set githubToken ghp_xxx --agent pm
```

### `clawup secrets list`

Show which secrets are configured (values redacted).

```bash
clawup secrets list
```

### `clawup list`

Show the project configuration.

```bash
clawup list          # Pretty-printed output
clawup list --json   # JSON output
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

### `clawup.yaml`

The `init` command generates a `clawup.yaml` manifest:

```yaml
stackName: dev
provider: aws
region: us-east-1
instanceType: t3.medium
ownerName: Your Name
agents:
  - name: agent-pm
    displayName: Juno
    role: pm
    identity: "https://github.com/your-org/army-identities#pm"
    volumeSize: 30
    plugins:
      openclaw-linear:
        agentId: agent-pm
      slack:
        mode: socket
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
packages/cli/
├── bin.ts              # Entry point (Commander.js program)
├── commands/           # Command handlers (init, deploy, ssh, secrets, push, webhooks, etc.)
├── tools/              # Tool implementations (adapter-based: deploy, destroy, redeploy, status, validate, push, webhooks)
├── lib/                # CLI-only utilities
│   ├── config.ts       # Load/save clawup.yaml manifest
│   ├── exec.ts         # Shell command execution
│   ├── prerequisites.ts # Prerequisite checks
│   ├── process.ts      # Graceful shutdown handling
│   ├── pulumi.ts       # Pulumi stack & config operations
│   ├── tailscale.ts    # Tailscale device management
│   ├── tool-helpers.ts # Shared helpers for tool implementations
│   └── ui.ts           # UI helpers (banners, spinners, formatting)
└── adapters/           # Runtime adapters (CLI vs API)

# Shared types, constants, and registries live in @clawup/core (packages/core/)
```

## Dependencies

- [Commander.js](https://github.com/tj/commander.js) — CLI argument parsing
- [@clack/prompts](https://github.com/natemoo-re/clack) — Interactive terminal prompts
- [picocolors](https://github.com/alexeyraspopov/picocolors) — Terminal colors
