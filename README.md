# Agent Army

[![npm](https://img.shields.io/npm/v/agent-army)](https://www.npmjs.com/package/agent-army)
[![license](https://img.shields.io/npm/l/agent-army)](./LICENSE)

Deploy a fleet of specialized [OpenClaw](https://openclaw.bot/) AI agents on **AWS** or **Hetzner Cloud** — managed entirely from your terminal.

## What Is This?

Agent Army provisions autonomous AI agents with persistent memory, role-specific behavior, and secure networking. Each agent runs in a Docker sandbox with its own identity — personality, skills, tools, and model preferences — connected over a Tailscale mesh VPN with no public port exposure.

You define _what_ your agents do. Agent Army handles _where_ and _how_ they run.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      AWS VPC / Hetzner Cloud                        │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │  Agent A      │   │  Agent B     │   │  Agent C     │             │
│  │              │   │              │   │              │             │
│  │  • OpenClaw  │   │  • OpenClaw  │   │  • OpenClaw  │             │
│  │  • Docker    │   │  • Docker    │   │  • Docker    │             │
│  │  • Tailscale │   │  • Tailscale │   │  • Tailscale │             │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘             │
│         └──────────────────┼──────────────────┘                     │
└────────────────────────────┼────────────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │   Tailscale Mesh VPN    │
                │   (Encrypted P2P)       │
                └────────────┬────────────┘
                             │
                ┌────────────▼────────────┐
                │     Your Machine        │
                └─────────────────────────┘
```

## Identity System

Agents are defined by **identities** — composable, self-contained packages that include everything an agent needs to operate: personality, skills, model preferences, plugin configuration, and dependencies.

### How Identities Work

An identity is a directory with an `identity.yaml` manifest and workspace files:

```
my-identity/
├── identity.yaml       # Manifest: model, plugins, deps, skills, template vars
├── SOUL.md             # Personality, role, approach, communication style
├── IDENTITY.md         # Name, role, emoji
├── HEARTBEAT.md        # Periodic tasks and state machine logic
├── TOOLS.md            # Tool reference (integrations, local env)
├── AGENTS.md           # Multi-agent coordination instructions
├── BOOTSTRAP.md        # First-run setup instructions
├── USER.md             # Owner-specific info (templated)
└── skills/             # Bundled skills
    └── my-skill/
        └── SKILL.md
```

Identities can live in a **Git repo**, a **monorepo subdirectory**, or a **local path**. Point any agent at any identity:

```yaml
# agent-army.yaml
agents:
  - name: agent-researcher
    displayName: Atlas
    role: researcher
    identity: "https://github.com/your-org/your-identities#researcher"
    identityVersion: "v1.0.0"   # optional: pin to a tag or commit
    volumeSize: 20
```

### `identity.yaml`

The identity manifest declares the agent's defaults:

```yaml
name: researcher
displayName: Atlas
role: researcher
emoji: telescope
description: Deep research, source analysis, report generation
volumeSize: 20

model: anthropic/claude-sonnet-4-5
codingAgent: claude-code

deps:
  - brave-search

plugins:
  - slack

pluginDefaults:
  slack:
    mode: socket
    dm:
      enabled: true
      policy: open

skills:
  - research-report

templateVars:
  - OWNER_NAME
  - TIMEZONE
  - WORKING_HOURS
  - USER_NOTES
```

### Built-in Identities

Agent Army ships with three built-in identities to get you started:

| Alias | Role | What It Does |
|-------|------|-------------|
| **Juno** | PM | Breaks down tickets, researches requirements, plans & sequences work, tracks progress |
| **Titus** | Engineer | Picks up tickets, writes code via Claude Code, builds/tests, creates PRs |
| **Scout** | Tester | Reviews PRs, tests happy/sad/edge cases, files bugs, verifies fixes |

These are standard identities hosted in a Git repo — the same format as any custom identity you'd create.

### Creating Your Own Identity

See the [`examples/identity/`](./examples/identity/) directory for a complete, minimal example (a "researcher" agent), and the [Creating Identities](./docs/guides/creating-identities.mdx) guide for the full authoring reference covering:

- Identity structure and required files
- `identity.yaml` field reference
- Workspace file conventions
- Skill authoring (private and public)
- Template variable substitution
- Available registries (deps, plugins, coding agents)

## Quick Start

### 1. Install

```bash
npm install -g agent-army
```

### 2. Run the Setup Wizard

```bash
agent-army init
```

The wizard walks you through:
- **Prerequisites check** — verifies Pulumi, Node.js, cloud provider CLI, and Tailscale
- **Cloud provider** — AWS or Hetzner Cloud
- **Region & instance type** — with cost estimates shown inline
- **Secrets** — Anthropic API key, Tailscale auth key (with instructions for each)
- **Agent selection** — pick from built-in identities, point to a Git repo or local directory, or mix both
- **Optional integrations** — Slack, Linear, GitHub per agent
- **Review & confirm** — see full config and estimated monthly cost

This generates an `agent-army.yaml` manifest and sets all Pulumi config values automatically.

### 3. Deploy

```bash
agent-army deploy
```

### 4. Validate

Wait 3-5 minutes for cloud-init to complete, then:

```bash
agent-army validate
```

### 5. Access Your Agents

```bash
agent-army ssh <agent-name>    # SSH by name, role, or alias
```

## CLI Reference

Run `agent-army --help` for the full list.

| Command | Description |
|---------|-------------|
| `agent-army init` | Interactive setup wizard |
| `agent-army deploy` | Deploy agents (`pulumi up` under the hood) |
| `agent-army deploy -y` | Deploy without confirmation prompt |
| `agent-army status` | Show agent statuses and outputs |
| `agent-army status --json` | Status in JSON format |
| `agent-army ssh <agent>` | SSH to an agent by name, role, or alias |
| `agent-army ssh <agent> '<cmd>'` | Run a command on an agent remotely |
| `agent-army validate` | Health check all agents via Tailscale |
| `agent-army destroy` | Tear down all resources (with confirmation) |
| `agent-army redeploy` | Update agents in-place (`pulumi up --refresh`) |
| `agent-army redeploy -y` | Redeploy without confirmation prompt |
| `agent-army destroy -y` | Tear down without confirmation |
| `agent-army list` | List saved configurations |
| `agent-army config show` | Display current config |
| `agent-army config show --json` | Config in JSON format |
| `agent-army config set <key> <value>` | Update a config value |
| `agent-army config set <key> <value> -a <agent>` | Update a per-agent config value |
| `agent-army config migrate` | Migrate old plugin config files into manifest |
| `agent-army secrets set <key> <value>` | Set a Pulumi secret (e.g. API keys) |
| `agent-army secrets list` | Show which secrets are configured (redacted) |
| `agent-army push` | Push workspace files, skills, and config to running agents |
| `agent-army webhooks setup` | Configure Linear webhooks for deployed agents |
| `agent-army update` | Update agent-army CLI to the latest version |

Agent resolution is flexible — all of these target the same agent:

```bash
agent-army ssh juno        # by alias
agent-army ssh pm          # by role
agent-army ssh agent-pm    # by resource name
```

## Cloud Providers

### Provider Comparison

| Feature | AWS | Hetzner Cloud |
|---------|-----|---------------|
| **3x Agents (monthly)** | ~$110-120 | ~$18-22 |
| **Instance Type** | t3.medium (2 vCPU, 4GB) | CX22 (2 vCPU, 4GB) |
| **Storage** | ~$2.40/month per 30GB | Included |
| **Data Transfer** | ~$5-10/month | 20TB included |
| **Regions** | Global (25+) | EU & US (5 locations) |
| **Setup Complexity** | Moderate (VPC, IAM) | Simple (API token) |

Use Hetzner for development and cost savings (~80% cheaper). Use AWS for production or global reach.

### What Gets Provisioned

Each agent gets:
- Cloud instance (EC2 or Hetzner server) with Ubuntu 24.04 LTS
- Docker (for OpenClaw sandbox)
- Node.js v22, OpenClaw CLI, coding agent CLI (from registry), GitHub CLI
- Tailscale VPN (encrypted mesh, no public ports)
- Workspace files and skills injected from its identity
- AI model configured per-identity (with fallback support)
- Plugins and deps installed per-identity

All agents share a single VPC/network for cost optimization.

## Dependencies

You need the following installed on your **local machine** before running `agent-army init`. The init wizard checks for these and will tell you what's missing.

### Required (all providers)

| Dependency | Why | Install |
|------------|-----|---------|
| **Node.js 18+** | Runtime for CLI and Pulumi program | [nodejs.org](https://nodejs.org/) |
| **Pulumi CLI** | Infrastructure provisioning | [pulumi.com/docs/iac/download-install](https://www.pulumi.com/docs/iac/download-install/) |
| **Pulumi Account** | State management and encrypted secrets | [app.pulumi.com/signup](https://app.pulumi.com/signup) |
| **Tailscale** | Secure mesh VPN to reach your agents | [tailscale.com/download](https://tailscale.com/download) |

### Required (provider-specific)

Pick one depending on where you want to deploy:

| Provider | Dependency | Install |
|----------|-----------|---------|
| **AWS** | AWS CLI (configured with credentials) | [aws.amazon.com/cli](https://aws.amazon.com/cli/) — then run `aws configure` |
| **Hetzner** | API token with Read & Write permissions | [console.hetzner.cloud](https://console.hetzner.cloud/) → Project → Security → API Tokens |

### Tailscale Setup

Tailscale requires a few one-time setup steps:

1. [Create an account](https://login.tailscale.com/start)
2. [Enable HTTPS certificates](https://tailscale.com/kb/1153/enabling-https) (required for OpenClaw web UI)
3. [Generate a reusable auth key](https://login.tailscale.com/admin/settings/keys) with tags
4. Note your tailnet DNS name (e.g., `tail12345.ts.net`)

### Installed on agents automatically

These are provisioned on the cloud instances via cloud-init — you do **not** need them locally:

- Docker, Node.js v22, OpenClaw CLI, coding agent CLI (e.g., Claude Code)
- Tailscale (agent-side)
- GitHub CLI, Brave Search, and other deps (per-identity)
- OpenClaw plugins: Linear, Slack (per-identity)

## Required API Keys

| Key | Required | Where to Get |
|-----|----------|--------------|
| **Anthropic Credentials** | Yes | [API Key](https://console.anthropic.com/) or OAuth token (`claude setup-token`) |
| **Tailscale Auth Key** | Yes | [Tailscale Admin](https://login.tailscale.com/admin/settings/keys) (reusable, with tags) |
| **Slack Bot Token** | No | [Slack API](https://api.slack.com/apps) — per agent |
| **Linear API Token** | No | [Linear Settings](https://linear.app/settings/api) — per agent |
| **GitHub Token** | No | [GitHub Settings](https://github.com/settings/tokens) — per agent |

### Claude Code Authentication

Two authentication methods are supported:

| Method | Token Format | Best For |
|--------|-------------|----------|
| **API Key** | `sk-ant-api03-...` | Pay-as-you-go API usage |
| **OAuth Token** | `sk-ant-oat01-...` | Pro/Max subscription (flat rate) |

The system auto-detects which type you provide and sets the correct environment variable.

## Updating & Redeploying

For in-place updates that preserve Tailscale devices and existing infrastructure:

```bash
agent-army redeploy
```

This runs `pulumi up --refresh` to sync cloud state and apply changes. If the stack doesn't exist yet, it falls back to a fresh deploy automatically.

For a clean rebuild (when in-place update can't recover):

```bash
agent-army destroy -y && agent-army deploy -y
```

## Configuration

### Viewing & Modifying Config

View your current configuration without opening the manifest file:

```bash
agent-army config show              # Human-readable summary
agent-army config show --json       # Full JSON output
```

Modify config values with validation (no need to re-run `init`):

```bash
agent-army config set region us-west-2
agent-army config set instanceType t3.large
agent-army config set instanceType cx32 -a atlas     # Per-agent override
agent-army config set volumeSize 50 -a atlas         # Per-agent volume
```

Run `agent-army redeploy` after changing config to apply.

### `agent-army.yaml`

Generated by `agent-army init`. This manifest drives the entire deployment:

```yaml
stackName: dev
provider: aws
region: us-east-1
instanceType: t3.medium
ownerName: Your Name
timezone: America/New_York
workingHours: 9am-6pm
agents:
  - name: agent-pm
    displayName: Juno
    role: pm
    identity: "https://github.com/your-org/army-identities#pm"
    volumeSize: 30
    plugins:
      - openclaw-linear
      - slack
    deps:
      - gh
      - brave-search
  - name: agent-researcher
    displayName: Atlas
    role: researcher
    identity: "./my-identities/researcher"
    volumeSize: 20
```

Model, backup model, and coding agent are configured in the identity (not the manifest). The manifest defines _which_ agents to deploy and _where_.

### Pulumi Config

Secrets are stored encrypted in Pulumi config, set automatically by the init wizard. You can also manage them directly:

```bash
pulumi config set --secret anthropicApiKey sk-ant-xxxxx
pulumi config set --secret tailscaleAuthKey tskey-auth-xxxxx
pulumi config set tailnetDnsName tail12345.ts.net
```

### Pulumi ESC

For more advanced secret management, use [Pulumi ESC](https://www.pulumi.com/docs/esc/). See `esc/agent-army-secrets.yaml.example` for the full template.

## Project Structure

```
agent-army/
├── packages/
│   ├── core/               # @agent-army/core — shared types, constants, registries
│   │   └── src/
│   │       ├── schemas/    # Zod schemas (source of truth for types)
│   │       ├── constants.ts
│   │       ├── identity.ts # Identity loader (Git repos, local paths)
│   │       ├── plugin-registry.ts
│   │       ├── coding-agent-registry.ts
│   │       ├── dep-registry.ts
│   │       └── skills.ts
│   ├── cli/                # agent-army CLI (published npm package)
│   │   ├── bin.ts          # Entry point (Commander.js)
│   │   ├── commands/       # init, deploy, redeploy, status, ssh, validate, destroy, config, list, push, secrets, webhooks, update
│   │   ├── tools/          # Tool implementations (adapter-based)
│   │   ├── lib/            # CLI-only: config, pulumi, ui, tailscale, exec
│   │   └── adapters/       # Runtime adapters (CLI vs API)
│   ├── pulumi/             # @agent-army/pulumi — infrastructure as code
│   │   └── src/
│   │       ├── components/
│   │       │   ├── openclaw-agent.ts    # AWS EC2 agent component
│   │       │   ├── hetzner-agent.ts     # Hetzner Cloud agent component
│   │       │   ├── cloud-init.ts        # Cloud-init script generation
│   │       │   └── config-generator.ts  # OpenClaw config builder
│   │       ├── shared-vpc.ts
│   │       └── index.ts    # Main Pulumi stack program
│   └── web/                # Next.js dashboard (agent-army-web)
├── identities/             # Built-in identity stubs (point to external repos)
├── examples/               # Example identities for reference
│   └── identity/           # Complete "researcher" identity example
├── docs/                   # Documentation (Mintlify site + guides)
├── esc/                    # Pulumi ESC secret templates
├── scripts/                # Shell script helpers
├── Pulumi.yaml             # Pulumi project config (points to packages/pulumi/)
└── pnpm-workspace.yaml     # Monorepo workspace config
```

## Security

- All agent ports bind to `127.0.0.1` — access is via **Tailscale only**
- No public port exposure; Tailscale Serve proxies traffic
- Token-based gateway authentication
- Secrets encrypted via Pulumi config
- Cloud-init scripts use environment variable interpolation
- SSH available as fallback for debugging

## Troubleshooting

### Agents not appearing in Tailscale

1. Wait 3-5 minutes for cloud-init to complete
2. Check logs: `agent-army ssh <agent> 'sudo cat /var/log/cloud-init-output.log | tail -100'`
3. Verify your Tailscale auth key is valid and reusable

### OpenClaw gateway not running

```bash
agent-army ssh <agent> 'openclaw gateway status'
agent-army ssh <agent> 'journalctl -u openclaw -n 50'
agent-army ssh <agent> 'openclaw gateway restart'
```

### SSH connection refused

1. Check Tailscale is running locally: `tailscale status`
2. Verify the agent appears in your tailnet
3. Ensure you're using the correct tailnet DNS name

### Pulumi state issues

```bash
pulumi refresh    # Refresh state from actual infrastructure
pulumi cancel     # Force unlock if locked
```

## Development

For contributing to Agent Army itself:

```bash
git clone https://github.com/stepandel/agent-army.git
cd agent-army
pnpm install
pnpm build                                # Build all packages
pnpm test                                 # Run all tests

# Individual packages
pnpm --filter @agent-army/core build      # Build core
pnpm --filter agent-army build            # Build CLI
pnpm --filter @agent-army/pulumi build    # Build Pulumi
pnpm --filter agent-army-web dev          # Web dev server
```

## License

MIT

## Related

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [Pulumi AWS Provider](https://www.pulumi.com/registry/packages/aws/)
- [Pulumi Hetzner Provider](https://www.pulumi.com/registry/packages/hcloud/)
- [Pulumi ESC](https://www.pulumi.com/docs/esc/)
- [Tailscale Documentation](https://tailscale.com/kb/)
