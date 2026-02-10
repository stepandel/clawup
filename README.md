# Agent Army 🅰

Deploy a fleet of specialized [OpenClaw](https://openclaw.bot/) AI agents on **AWS** or **Hetzner Cloud** — managed entirely from your terminal.

## What Is This?

Agent Army provisions a team of autonomous AI agents that handle software engineering tasks — product management & research, development, and QA — with persistent memory and role-specific behavior. Agents communicate over a secure Tailscale mesh VPN with no public port exposure.

```
┌──────────────────────────────────────────────────────────────────────┐
│                      AWS VPC / Hetzner Cloud                        │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │  Juno (PM) │   │ Titus (Eng)  │   │ Scout (QA)   │            │
│  │              │   │              │   │              │            │
│  │  • OpenClaw  │   │  • OpenClaw  │   │  • OpenClaw  │            │
│  │  • Docker    │   │  • Docker    │   │  • Docker    │            │
│  │  • Tailscale │   │  • Tailscale │   │  • Tailscale │            │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘            │
│         └──────────────────┼──────────────────┘                    │
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

## Quick Start

Everything is done through the CLI.

### 1. Install

```bash
npm install -g @agent-army/cli
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
- **Agent selection** — pick from presets, define custom agents, or mix both
- **Optional integrations** — Slack, Linear, GitHub per agent
- **Review & confirm** — see full config and estimated monthly cost

This generates an `agent-army.json` manifest and sets all Pulumi config values automatically.

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
agent-army ssh juno    # SSH to PM agent
agent-army ssh titus     # SSH to Engineer agent
agent-army ssh scout     # SSH to QA agent
```

## CLI Reference

The CLI is the primary interface for every operation. Run `agent-army --help` for the full list.

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
| `agent-army destroy -y` | Tear down without confirmation |
| `agent-army list` | List saved configurations |

Agent resolution is flexible — all of these target the same agent:

```bash
agent-army ssh juno      # by alias
agent-army ssh pm          # by role
agent-army ssh agent-pm    # by resource name
```

## Preset Agents

Agent Army ships with three battle-tested agent presets:

| Alias | Role | What It Does |
|-------|------|-------------|
| **Juno** | PM | Breaks down tickets, researches requirements, plans & sequences work, tracks progress, unblocks teams |
| **Titus** | Engineer | Picks up tickets, writes code via Claude Code, builds/tests, creates PRs, responds to reviews |
| **Scout** | Tester | Reviews PRs, tests happy/sad/edge cases, files bugs, verifies fixes |

Each agent is defined by workspace files in `presets/`:

```
presets/
├── base/           # Shared across all agents (AGENTS.md, BOOTSTRAP.md, USER.md)
├── pm/             # Juno: SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
├── eng/            # Titus: SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
├── tester/         # Scout: SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
└── skills/         # Reusable skills (ticket prep, PR testing, review workflows)
```

You can also define fully custom agents during `agent-army init`.

### Customizing Agent Behavior

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality, role, approach, communication style |
| `IDENTITY.md` | Name, role, emoji |
| `HEARTBEAT.md` | Periodic tasks and state machine logic |
| `TOOLS.md` | Tool reference (Linear, Slack, GitHub, local env) |

Template variables are supported in preset files:

| Variable | Description |
|----------|-------------|
| `{{OWNER_NAME}}` | Agent owner name |
| `{{TIMEZONE}}` | Owner timezone |
| `{{WORKING_HOURS}}` | Working hours for scheduling |
| `{{USER_NOTES}}` | Custom notes for the agent |
| `{{LINEAR_TEAM}}` | Default Linear team ID |
| `{{GITHUB_REPO}}` | Default GitHub repository |

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
- Node.js v22, OpenClaw CLI, Claude Code CLI, GitHub CLI
- Tailscale VPN (encrypted mesh, no public ports)
- Workspace files injected from `presets/`
- Optional: Linear CLI (via Deno), Slack integration

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

- Docker, Node.js v22, OpenClaw CLI, Claude Code CLI, GitHub CLI
- Deno + Linear CLI (if Linear integration is enabled)
- Tailscale (agent-side)

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

Always use a full teardown and rebuild to avoid stale Tailscale devices:

```bash
agent-army destroy
agent-army deploy
```

Or with auto-confirm:

```bash
agent-army destroy -y && agent-army deploy -y
```

A simple `deploy` after changes can leave orphaned Tailscale devices and hostname conflicts. The destroy-then-deploy workflow ensures clean state.

## Configuration

### `agent-army.json`

Generated by `agent-army init`. This manifest drives the entire deployment:

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
├── cli/                    # CLI tool (commands, prompts, config management)
│   ├── bin.ts              # Entry point (Commander.js)
│   ├── commands/           # init, deploy, status, ssh, validate, destroy, list
│   ├── lib/                # Config, prerequisites, Pulumi ops, UI helpers
│   └── types.ts            # TypeScript types
├── src/                    # Reusable Pulumi components
│   └── components/
│       ├── openclaw-agent.ts    # AWS EC2 agent component
│       ├── hetzner-agent.ts     # Hetzner Cloud agent component
│       ├── cloud-init.ts        # Cloud-init script generation
│       └── config-generator.ts  # OpenClaw config builder
├── presets/                # Agent role definitions & shared skills
│   ├── base/               # Shared files for all agents
│   ├── pm/                 # Juno (PM)
│   ├── eng/                # Titus (Engineer)
│   ├── tester/             # Scout (QA)
│   └── skills/             # Reusable agent skills
├── docs/                   # Mintlify documentation site
├── esc/                    # Pulumi ESC secret templates
├── scripts/                # Shell script helpers
├── examples/               # Example deployments
├── index.ts                # Main Pulumi stack program
├── shared-vpc.ts           # Shared VPC component (AWS)
└── Pulumi.yaml             # Pulumi project config
```

## Security

- All agent ports bind to `127.0.0.1` — access is via **Tailscale only**
- No public port exposure; Tailscale Serve proxies traffic
- Token-based gateway authentication
- Secrets encrypted via Pulumi config
- SSH available as fallback for debugging

## Troubleshooting

### Agents not appearing in Tailscale

1. Wait 3-5 minutes for cloud-init to complete
2. Check logs: `agent-army ssh pm 'sudo cat /var/log/cloud-init-output.log | tail -100'`
3. Verify your Tailscale auth key is valid and reusable

### OpenClaw gateway not running

```bash
agent-army ssh pm 'openclaw gateway status'
agent-army ssh pm 'journalctl -u openclaw -n 50'
agent-army ssh pm 'openclaw gateway restart'
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
pnpm build
pnpm run watch    # Watch mode
```

## License

MIT

## Related

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [Pulumi AWS Provider](https://www.pulumi.com/registry/packages/aws/)
- [Pulumi Hetzner Provider](https://www.pulumi.com/registry/packages/hcloud/)
- [Pulumi ESC](https://www.pulumi.com/docs/esc/)
- [Tailscale Documentation](https://tailscale.com/kb/)
