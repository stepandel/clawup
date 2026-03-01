# Clawup CLI

[![npm](https://img.shields.io/npm/v/clawup)](https://www.npmjs.com/package/clawup)

Command-line tool for deploying and managing your fleet of [OpenClaw](https://openclaw.bot/) AI agents on **AWS** or **Hetzner Cloud**.

## Installation

```bash
# Global install
npm install -g clawup

# Or run directly
npx clawup init
```

## Commands

### `clawup init`

Generates a `clawup.yaml` manifest and `.env.example` in the current directory. Non-interactive — edit the YAML by hand to configure your deployment.

**Fresh init** (no `clawup.yaml`): discovers local identity directories and scaffolds a new manifest with sensible defaults (AWS, us-east-1, t3.medium).

**Repair mode** (existing `clawup.yaml`): re-fetches identities, updates secrets/plugins/deps from latest identity data, regenerates `.env.example`. Existing manifest values are preserved.

```bash
clawup init              # Generate scaffold (or refresh if clawup.yaml exists)
```

### `clawup deploy`

Validates secrets from `.env`, configures Pulumi, and deploys your agents with `pulumi up`. Handles everything that `clawup setup` used to do, plus the actual deployment.

```bash
clawup deploy                            # Deploy with confirmation prompt
clawup deploy -y                         # Skip confirmation
clawup deploy --local                    # Deploy to local Docker containers
clawup deploy --env-file /path/to/.env   # Custom .env location
clawup deploy --skip-hooks               # Skip plugin lifecycle hooks
```

### `clawup status`

Show agent statuses from Pulumi stack outputs.

```bash
clawup status             # Pretty-printed output
clawup status --json      # JSON output
clawup status --local     # Local Docker container status
```

### `clawup ssh <agent>`

SSH to an agent by name, role, or displayName. Resolves agents flexibly — all of these work:

```bash
clawup ssh pm          # By role
clawup ssh agent-pm    # By resource name
clawup ssh juno        # By displayName
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
clawup validate --local    # Validate local Docker containers
```

### `clawup destroy`

Tear down all resources with safety confirmations.

```bash
clawup destroy             # With confirmation prompts
clawup destroy -y          # Skip confirmations (dangerous!)
clawup destroy --local     # Destroy local Docker containers only
```

### `clawup redeploy`

Update agents in-place without destroying infrastructure. Runs `pulumi up --refresh` to sync cloud state and apply changes. If the stack doesn't exist, falls back to a fresh deploy.

```bash
clawup redeploy             # With confirmation prompt
clawup redeploy -y          # Skip confirmation
clawup redeploy --local     # Redeploy local Docker containers
```

### `clawup config show`

Display current configuration in a human-readable format.

```bash
clawup config show             # Pretty-printed output
clawup config show --json      # Full JSON output
```

### `clawup config set <key> <value>`

Update a config value with validation. No need to re-run `init`.

Top-level keys: `region`, `instanceType`, `ownerName`, `timezone`, `workingHours`, `userNotes`, `templateVars.<KEY>`

Per-agent keys: `instanceType`, `volumeSize`, `displayName`

```bash
clawup config set region us-west-2
clawup config set instanceType t3.large
clawup config set instanceType cx32 -a titus   # Per-agent override
clawup config set volumeSize 50 -a scout       # Per-agent volume
```

### `clawup secrets set <key> <value>`

Set a Pulumi secret directly. Useful for adding or rotating API keys post-setup.

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

## Agents

Agents are discovered from local identity directories (subdirectories containing `identity.yaml`) during `clawup init`. Each identity defines the agent's name, role, personality, skills, and configuration. See the [example identity](https://github.com/stepandel/clawup/tree/main/examples/identity) for the expected structure.

## Configuration

Clawup uses a project-based configuration model. All commands auto-detect the project root by walking up from the current directory looking for `clawup.yaml`. Run commands from anywhere inside your project directory.

```
my-project/
├── clawup.yaml          # Deployment manifest (created by clawup init)
├── .clawup/             # Pulumi state, workspace files (git-ignored)
└── ...
```

### `clawup.yaml`

The `init` command generates a `clawup.yaml` manifest at the project root:

```yaml
stackName: dev
provider: aws
region: us-east-1
instanceType: t3.medium
ownerName: Your Name
secrets:
  anthropicApiKey: "${env:ANTHROPIC_API_KEY}"
  tailscaleAuthKey: "${env:TAILSCALE_AUTH_KEY}"
  tailnetDnsName: "${env:TAILNET_DNS_NAME}"
agents:
  - name: agent-pm
    displayName: Juno
    role: pm
    identity: "https://github.com/your-org/army-identities#pm"
    volumeSize: 30
    secrets:
      slackBotToken: "${env:PM_SLACK_BOT_TOKEN}"
      slackAppToken: "${env:PM_SLACK_APP_TOKEN}"
    plugins:
      openclaw-linear:
        agentId: agent-pm
      slack:
        mode: socket
```

The `secrets` section uses `${env:VAR}` references — actual values come from a `.env` file. This manifest is read by the Pulumi program at deploy time to dynamically create the agent stack.

### Pulumi Config

Secrets and stack configuration are stored in Pulumi config (encrypted). The `deploy` command sets these automatically:

- `anthropicApiKey` (secret)
- `tailscaleAuthKey` (secret)
- `tailnetDnsName`
- `provider`, `modelProvider`, `defaultModel`
- `aws:region` (AWS) or `hetzner:location` (Hetzner)
- `instanceType`, `ownerName`, `timezone`, `workingHours`, `userNotes`
- Per-agent secrets (Slack, Linear, GitHub tokens, etc.)

## Project Structure

```
packages/cli/
├── bin.ts              # Entry point (Commander.js program)
├── commands/           # Command handlers (init, deploy, ssh, secrets, push, webhooks, etc.)
├── tools/              # Tool implementations (adapter-based: deploy, destroy, redeploy, status, validate, push, webhooks)
├── lib/                # CLI-only utilities
│   ├── config.ts       # Load/save clawup.yaml manifest
│   ├── constants.ts    # CLI-specific constants
│   ├── env.ts          # .env parser, ${env:VAR} resolver, secret builder
│   ├── exec.ts         # Shell command execution
│   ├── prerequisites.ts # Prerequisite checks
│   ├── process.ts      # Graceful shutdown handling
│   ├── project.ts      # Project root finder
│   ├── pulumi.ts       # Pulumi stack & config operations
│   ├── tailscale.ts    # Tailscale device management
│   ├── tool-helpers.ts # Shared helpers for tool implementations
│   ├── ui.ts           # UI helpers (banners, spinners, formatting)
│   ├── update-check.ts # Update notification system
│   ├── vendor.ts       # Vendor utilities
│   └── workspace.ts    # Workspace file management
└── adapters/           # Runtime adapters (CLI vs API)

# Shared types, constants, and registries live in @clawup/core (packages/core/)
```

## Dependencies

- [Commander.js](https://github.com/tj/commander.js) — CLI argument parsing
- [@clack/prompts](https://github.com/natemoo-re/clack) — Interactive terminal prompts
- [picocolors](https://github.com/alexeyraspopov/picocolors) — Terminal colors
