# Agent Army 🦞

Deploy a fleet of specialized [OpenClaw](https://openclaw.bot/) AI agents on AWS using Pulumi.

Based on the [Pulumi blog post: Deploy OpenClaw on AWS or Hetzner Securely with Pulumi and Tailscale](https://www.pulumi.com/blog/deploy-openclaw-aws-hetzner/).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AWS VPC                                     │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │   EC2: agent-pm │  │  EC2: agent-eng │  │ EC2: agent-tester│          │
│  │   (Sage)        │  │   (Atlas)       │  │    (Scout)       │          │
│  │                 │  │                 │  │                  │          │
│  │  • OpenClaw     │  │  • OpenClaw     │  │  • OpenClaw      │          │
│  │  • Docker       │  │  • Docker       │  │  • Docker        │          │
│  │  • Tailscale    │  │  • Tailscale    │  │  • Tailscale     │          │
│  │                 │  │                 │  │                  │          │
│  │  Role: PM       │  │  Role: Engineer │  │  Role: QA        │          │
│  └────────┬────────┘  └────────┬────────┘  └────────┬─────────┘          │
│           │                    │                    │                    │
└───────────┼────────────────────┼────────────────────┼────────────────────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    Tailscale Mesh VPN   │
                    │    (Encrypted P2P)      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     Your Machine        │
                    │   (Tailscale Client)    │
                    └─────────────────────────┘
```

**Key Points:**
- All 3 agents share a single VPC (cost optimization)
- Communication is via Tailscale mesh VPN (no public port exposure)
- Each agent has role-specific workspace files from `presets/`
- Cloud-init handles full automation (Docker, Node.js, OpenClaw, Tailscale)

## Prerequisites

| Requirement | Description | Link |
|-------------|-------------|------|
| **Pulumi CLI** | Infrastructure as code tool | [Install Pulumi](https://www.pulumi.com/docs/iac/download-install/) |
| **Pulumi Account** | For state management & secrets | [Sign Up](https://app.pulumi.com/signup) |
| **Node.js 18+** | JavaScript runtime | [Download](https://nodejs.org/) |
| **AWS CLI** | AWS credentials configuration | [Install AWS CLI](https://aws.amazon.com/cli/) |
| **AWS Account** | For EC2 instances | [Create Account](https://aws.amazon.com/) |
| **Tailscale** | Mesh VPN for secure access | [Download](https://tailscale.com/download) |
| **Anthropic API Key** | For Claude AI | [Console](https://console.anthropic.com/) |

### AWS Credentials

Configure AWS credentials using one of these methods:

```bash
# Option 1: AWS CLI configuration
aws configure

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"

# Option 3: AWS SSO
aws sso login --profile your-profile
```

### Tailscale Setup

1. [Create a Tailscale account](https://login.tailscale.com/start)
2. [Enable HTTPS certificates](https://tailscale.com/kb/1153/enabling-https) (required for OpenClaw web UI)
3. [Generate an auth key](https://login.tailscale.com/admin/settings/keys) (reusable, with tags)
4. Note your tailnet DNS name (e.g., `tail12345.ts.net`)

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-org/agent-army.git
cd agent-army
npm install
```

### 2. Configure Secrets

Using [Pulumi ESC](https://www.pulumi.com/docs/esc/) (recommended):

```bash
# Create the ESC environment
pulumi env init your-org/agent-army-dev

# Copy the example and edit with your values
cp esc/agent-army-secrets.yaml.example esc/agent-army-secrets.yaml
# Edit esc/agent-army-secrets.yaml with your API keys

# Import to ESC
pulumi env edit your-org/agent-army-dev < esc/agent-army-secrets.yaml
```

Or set config directly:

```bash
pulumi stack init dev
pulumi config set --secret anthropicApiKey sk-ant-xxxxx
pulumi config set --secret tailscaleAuthKey tskey-auth-xxxxx
pulumi config set tailnetDnsName tail12345.ts.net
pulumi config set ownerName "Your Name"
```

### 3. Deploy

```bash
./scripts/deploy.sh
```

Or manually:

```bash
pulumi stack select dev
pulumi up
```

### 4. Validate

Wait 3-5 minutes for cloud-init to complete, then:

```bash
./scripts/validate.sh
```

### 5. Access Your Agents

Via Tailscale URL (web UI):

```bash
pulumi stack output pmTailscaleUrl --show-secrets
```

Via SSH:

```bash
./scripts/ssh.sh pm      # SSH to PM agent (Sage)
./scripts/ssh.sh eng     # SSH to Eng agent (Atlas)
./scripts/ssh.sh tester  # SSH to Tester agent (Scout)
```

## Required API Keys

| Key | Where to Get | Used For |
|-----|--------------|----------|
| **Anthropic API Key** | [Anthropic Console](https://console.anthropic.com/) | Claude AI models (required) |
| **Tailscale Auth Key** | [Tailscale Admin → Keys](https://login.tailscale.com/admin/settings/keys) | VPN mesh connectivity (required) |
| **Slack Bot Token** | [Slack API](https://api.slack.com/apps) → OAuth & Permissions | Agent communication (optional) |
| **Slack Signing Secret** | [Slack API](https://api.slack.com/apps) → Basic Information | Webhook verification (optional) |
| **Linear API Token** | [Linear Settings](https://linear.app/settings/api) | Issue tracking (optional) |

### API Key Configuration

Keys are managed via Pulumi ESC. See `esc/agent-army-secrets.yaml.example` for the full template.

**Shared keys** (used by all agents):
- `anthropicApiKey` - Required
- `tailscaleAuthKey` - Required

**Per-agent keys** (optional):
- `pmSlackToken`, `pmSlackSigningSecret`, `pmLinearToken`
- `engSlackToken`, `engSlackSigningSecret`, `engLinearToken`
- `testerSlackToken`, `testerSlackSigningSecret`, `testerLinearToken`

## Scripts

| Script | Description |
|--------|-------------|
| `./scripts/deploy.sh` | Deploy stack with prereq checks |
| `./scripts/validate.sh` | Health check all agents via Tailscale SSH |
| `./scripts/destroy.sh` | Tear down stack with confirmation |
| `./scripts/ssh.sh <agent>` | Quick SSH to agent (pm\|eng\|tester) |

All scripts support `-h` for help.

## Per-Agent Customization

Each agent loads workspace files from `presets/`:

```
presets/
├── base/           # Shared files (AGENTS.md, TOOLS.md, etc.)
├── pm/             # PM-specific (SOUL.md, HEARTBEAT.md)
├── eng/            # Eng-specific (SOUL.md, HEARTBEAT.md)
└── tester/         # Tester-specific (SOUL.md, HEARTBEAT.md)
```

### Customizing Agent Behavior

1. **Edit SOUL.md** - Define the agent's personality and role
2. **Edit HEARTBEAT.md** - Define periodic tasks and checks
3. **Edit TOOLS.md** - Add agent-specific tool configurations

Example: Making the PM agent focus on sprint planning:

```markdown
# presets/pm/SOUL.md

You are Sage, the Project Manager agent.

## Primary Responsibilities
- Sprint planning and tracking
- Stakeholder communication
- Blockers and risk management

## Communication Style
- Clear, concise updates
- Proactive status reports
- ...
```

### Template Variables

Use `{{VARIABLE}}` syntax in preset files. Currently supported:

| Variable | Description |
|----------|-------------|
| `{{OWNER_NAME}}` | Name of the agent owner (from config) |

## Troubleshooting

### Agents not appearing in Tailscale

1. Wait 3-5 minutes for cloud-init to complete
2. Check cloud-init logs:
   ```bash
   ./scripts/ssh.sh pm 'sudo cat /var/log/cloud-init-output.log | tail -100'
   ```
3. Verify Tailscale auth key is valid and reusable

### OpenClaw gateway not running

```bash
# Check service status
./scripts/ssh.sh pm 'openclaw gateway status'

# View gateway logs
./scripts/ssh.sh pm 'journalctl -u openclaw -n 50'

# Restart gateway
./scripts/ssh.sh pm 'openclaw gateway restart'
```

### Workspace files missing

```bash
# List workspace contents
./scripts/ssh.sh pm 'ls -la ~/.openclaw/workspace/'

# Re-run cloud-init (regenerates workspace)
./scripts/ssh.sh pm 'sudo cloud-init clean && sudo cloud-init init'
```

### SSH connection refused

1. Verify Tailscale is running on your machine: `tailscale status`
2. Check if the agent appears in your tailnet
3. Ensure you're using the correct tailnet DNS name

### Pulumi state issues

```bash
# Refresh state from actual infrastructure
pulumi refresh

# Force unlock (if locked)
pulumi cancel
```

## Cost Estimate

| Resource | Quantity | Instance Type | Monthly Cost (US-East-1) |
|----------|----------|---------------|--------------------------|
| EC2 Instances | 3 | t3.medium | $33 × 3 = **$99** |
| EBS Storage | 3 × 30GB | gp3 | ~$2.40 × 3 = **$7.20** |
| Data Transfer | Variable | - | ~**$5-10** |
| **Total** | | | **~$110-120/month** |

**Cost Optimization Tips:**
- Use Spot Instances for non-critical workloads
- Schedule instances to stop during off-hours
- Use smaller instances for testing (t3.small: ~$17/month each)

**⚠️ Do not use t3.micro** - 1GB RAM is insufficient for OpenClaw + Docker.

## Component API

### `OpenClawAgent`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `anthropicApiKey` | `string` | **required** | Anthropic API key |
| `tailscaleAuthKey` | `string` | **required** | Tailscale auth key |
| `tailnetDnsName` | `string` | **required** | Tailnet DNS name |
| `instanceType` | `string` | `t3.medium` | EC2 instance type |
| `vpcId` | `string` | - | Existing VPC ID |
| `subnetId` | `string` | - | Existing subnet ID |
| `securityGroupId` | `string` | - | Existing security group ID |
| `model` | `string` | `anthropic/claude-sonnet-4` | AI model |
| `enableSandbox` | `boolean` | `true` | Enable Docker sandbox |
| `gatewayPort` | `number` | `18789` | Gateway port |
| `browserPort` | `number` | `18791` | Browser control port |
| `volumeSize` | `number` | `30` | Root volume size (GB) |
| `tags` | `Record<string, string>` | - | Resource tags |
| `workspaceFiles` | `Record<string, string>` | - | Workspace files to inject |
| `envVars` | `Record<string, string>` | - | Environment variables |
| `postSetupCommands` | `string[]` | - | Post-setup shell commands |

### Outputs

| Output | Description |
|--------|-------------|
| `publicIp` | EC2 public IP |
| `tailscaleUrl` | Tailscale URL with auth token |
| `gatewayToken` | Gateway auth token |
| `sshPrivateKey` | SSH private key (Ed25519) |
| `instanceId` | EC2 instance ID |

## Examples

See the [examples/](./examples/) directory:

- **[single-agent](./examples/single-agent/)**: Basic single agent deployment
- **[existing-vpc](./examples/existing-vpc/)**: Deploy into existing infrastructure

## Security

- Gateway and browser ports are **not exposed publicly**
- Access is via **Tailscale only** (encrypted mesh VPN)
- SSH remains as fallback for debugging
- Token-based authentication for the gateway
- Secrets managed via Pulumi ESC

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch
```

## License

MIT

## Related

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [Pulumi AWS Provider](https://www.pulumi.com/registry/packages/aws/)
- [Pulumi ESC](https://www.pulumi.com/docs/esc/)
- [Tailscale Documentation](https://tailscale.com/kb/)
