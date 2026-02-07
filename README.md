# Agent Army 🦞

Reusable Pulumi components for deploying [OpenClaw](https://openclaw.bot/) AI agents on AWS.

Based on the [Pulumi blog post: Deploy OpenClaw on AWS or Hetzner Securely with Pulumi and Tailscale](https://www.pulumi.com/blog/deploy-openclaw-aws-hetzner/).

## Features

- **Reusable Component**: Deploy OpenClaw agents as a single `OpenClawAgent` component
- **Secure by Default**: Tailscale integration keeps your agent off the public internet
- **Flexible Infrastructure**: Create new VPC or use existing VPC/subnet/security group
- **Full Automation**: Cloud-init handles Docker, Node.js, OpenClaw, and Tailscale setup
- **Workspace Injection**: Pre-configure agent with custom workspace files

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/iac/download-install/) installed
- [Pulumi Cloud account](https://app.pulumi.com/signup)
- AWS account with credentials configured
- [Anthropic API key](https://console.anthropic.com/)
- [Tailscale account](https://tailscale.com/) with [HTTPS enabled](https://tailscale.com/kb/1153/enabling-https)

## Quick Start

### 1. Install dependencies

```bash
npm install agent-army @pulumi/pulumi @pulumi/aws @pulumi/tls
```

### 2. Configure secrets

Using [Pulumi ESC](https://www.pulumi.com/docs/esc/) (recommended):

```bash
pulumi env init <your-org>/openclaw-secrets
```

Add to your environment:
```yaml
values:
  anthropicApiKey:
    fn::secret: "sk-ant-xxxxx"
  tailscaleAuthKey:
    fn::secret: "tskey-auth-xxxxx"
  tailnetDnsName: "tailxxxxx.ts.net"
  pulumiConfig:
    anthropicApiKey: ${anthropicApiKey}
    tailscaleAuthKey: ${tailscaleAuthKey}
    tailnetDnsName: ${tailnetDnsName}
```

Or set config directly:
```bash
pulumi config set --secret anthropicApiKey sk-ant-xxxxx
pulumi config set --secret tailscaleAuthKey tskey-auth-xxxxx
pulumi config set tailnetDnsName tailxxxxx.ts.net
```

### 3. Deploy

```typescript
import * as pulumi from "@pulumi/pulumi";
import { OpenClawAgent } from "agent-army";

const config = new pulumi.Config();

const agent = new OpenClawAgent("my-agent", {
  anthropicApiKey: config.requireSecret("anthropicApiKey"),
  tailscaleAuthKey: config.requireSecret("tailscaleAuthKey"),
  tailnetDnsName: config.require("tailnetDnsName"),
});

export const tailscaleUrl = agent.tailscaleUrl;
export const publicIp = agent.publicIp;
```

```bash
pulumi up
```

### 4. Access your agent

Wait 3-5 minutes for cloud-init to complete, then:

```bash
pulumi stack output tailscaleUrl
```

Open the URL in your browser to access the OpenClaw web UI.

## Component API

### `OpenClawAgent`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `anthropicApiKey` | `string` | **required** | Anthropic API key |
| `tailscaleAuthKey` | `string` | **required** | Tailscale auth key |
| `tailnetDnsName` | `string` | **required** | Your Tailnet DNS name (e.g., tailxxxxx.ts.net) |
| `instanceType` | `string` | `t3.medium` | EC2 instance type (avoid t3.micro) |
| `vpcId` | `string` | - | Existing VPC ID (creates new if not provided) |
| `subnetId` | `string` | - | Existing subnet ID |
| `securityGroupId` | `string` | - | Existing security group ID |
| `model` | `string` | `anthropic/claude-sonnet-4` | AI model to use |
| `enableSandbox` | `boolean` | `true` | Enable Docker sandbox |
| `gatewayPort` | `number` | `18789` | Gateway port |
| `browserPort` | `number` | `18791` | Browser control port |
| `volumeSize` | `number` | `30` | Root volume size in GB |
| `tags` | `Record<string, string>` | - | Additional resource tags |
| `workspaceFiles` | `Record<string, string>` | - | Files to inject into workspace |
| `envVars` | `Record<string, string>` | - | Additional environment variables |
| `postSetupCommands` | `string[]` | - | Custom post-setup shell commands |

### Outputs

| Output | Description |
|--------|-------------|
| `publicIp` | EC2 instance public IP |
| `publicDns` | EC2 instance public DNS |
| `tailscaleUrl` | Full Tailscale URL with auth token |
| `gatewayToken` | Gateway authentication token |
| `sshPrivateKey` | SSH private key (Ed25519) |
| `sshPublicKey` | SSH public key |
| `instanceId` | EC2 instance ID |
| `vpcId` | VPC ID (created or provided) |
| `subnetId` | Subnet ID (created or provided) |
| `securityGroupId` | Security Group ID (created or provided) |

## Examples

See the [examples/](./examples/) directory:

- **[single-agent](./examples/single-agent/)**: Basic single agent deployment
- **[existing-vpc](./examples/existing-vpc/)**: Deploy into existing infrastructure

## Cost Considerations

| Instance Type | vCPUs | Memory | Monthly Cost* |
|--------------|-------|--------|---------------|
| t3.medium | 2 | 4 GB | ~$33 |
| t3.large | 2 | 8 GB | ~$66 |
| t3.xlarge | 4 | 16 GB | ~$132 |

*US East region, on-demand pricing. Includes 30GB gp3 storage.

⚠️ **Do not use t3.micro** - 1GB memory is insufficient for OpenClaw installation.

## Security

This component follows security best practices:

- Gateway and browser ports are **not exposed publicly**
- Access is via **Tailscale only** (encrypted mesh VPN)
- SSH remains as fallback for debugging
- Token-based authentication for the gateway
- Secrets managed via Pulumi ESC

For maximum security, remove the SSH ingress rule after confirming Tailscale works.

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
- [Pulumi Blog Post](https://www.pulumi.com/blog/deploy-openclaw-aws-hetzner/)
