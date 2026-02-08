/**
 * OpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on AWS EC2
 */

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as tls from "@pulumi/tls";
import * as crypto from "crypto";
import { generateCloudInit, interpolateCloudInit, CloudInitConfig } from "./cloud-init";

/**
 * Arguments for creating an OpenClaw Agent
 */
export interface OpenClawAgentArgs {
  /**
   * EC2 instance type (default: t3.medium)
   * WARNING: Do not use t3.micro - 1GB memory is insufficient
   */
  instanceType?: pulumi.Input<string>;

  /**
   * Anthropic API key (required)
   */
  anthropicApiKey: pulumi.Input<string>;

  /**
   * Tailscale auth key for secure access (required)
   * Generate at: https://login.tailscale.com/admin/settings/keys
   */
  tailscaleAuthKey: pulumi.Input<string>;

  /**
   * Your Tailnet DNS name (e.g., tailxxxxx.ts.net)
   * Find it in Tailscale admin console under DNS
   */
  tailnetDnsName: pulumi.Input<string>;

  /**
   * Existing VPC ID. If not provided, creates a new VPC
   */
  vpcId?: pulumi.Input<string>;

  /**
   * Existing Subnet ID. If not provided, creates a new subnet
   */
  subnetId?: pulumi.Input<string>;

  /**
   * Existing Security Group ID. If not provided, creates one
   */
  securityGroupId?: pulumi.Input<string>;

  /**
   * AI model to use (default: anthropic/claude-sonnet-4)
   */
  model?: pulumi.Input<string>;

  /**
   * Enable Docker sandbox for code execution (default: true)
   */
  enableSandbox?: pulumi.Input<boolean>;

  /**
   * Gateway port (default: 18789)
   */
  gatewayPort?: pulumi.Input<number>;

  /**
   * Browser control port (default: 18791)
   */
  browserPort?: pulumi.Input<number>;

  /**
   * EBS root volume size in GB (default: 30)
   */
  volumeSize?: pulumi.Input<number>;

  /**
   * Additional tags to apply to all resources
   */
  tags?: pulumi.Input<Record<string, pulumi.Input<string>>>;

  /**
   * Workspace files to inject (path -> content)
   */
  workspaceFiles?: Record<string, string>;

  /**
   * Additional environment variables for the agent
   */
  envVars?: Record<string, string>;

  /**
   * Custom post-setup shell commands
   */
  postSetupCommands?: string[];

  /**
   * AWS region (uses default provider region if not specified)
   */
  region?: pulumi.Input<string>;

  /**
   * Slack bot token (xoxb-...) for Socket Mode
   */
  slackBotToken?: pulumi.Input<string>;

  /**
   * Slack app token (xapp-...) for Socket Mode
   */
  slackAppToken?: pulumi.Input<string>;

  /**
   * Linear API key for issue tracking
   */
  linearApiKey?: pulumi.Input<string>;

  /**
   * Brave Search API key for web search
   */
  braveSearchApiKey?: pulumi.Input<string>;
}

/**
 * Outputs from an OpenClaw Agent deployment
 */
export interface OpenClawAgentOutputs {
  /** EC2 instance public IP */
  publicIp: pulumi.Output<string>;
  /** EC2 instance public DNS */
  publicDns: pulumi.Output<string>;
  /** Tailscale URL with authentication token */
  tailscaleUrl: pulumi.Output<string>;
  /** Gateway authentication token */
  gatewayToken: pulumi.Output<string>;
  /** SSH private key (Ed25519) */
  sshPrivateKey: pulumi.Output<string>;
  /** SSH public key */
  sshPublicKey: pulumi.Output<string>;
  /** EC2 instance ID */
  instanceId: pulumi.Output<string>;
  /** VPC ID (created or provided) */
  vpcId: pulumi.Output<string>;
  /** Subnet ID (created or provided) */
  subnetId: pulumi.Output<string>;
  /** Security Group ID (created or provided) */
  securityGroupId: pulumi.Output<string>;
}

/**
 * OpenClaw Agent ComponentResource
 *
 * Provisions a complete OpenClaw agent on AWS EC2 including:
 * - VPC, subnet, and security group (or uses existing)
 * - EC2 instance with Ubuntu 24.04
 * - Docker, Node.js 22, and OpenClaw installation
 * - Tailscale for secure HTTPS access
 * - Systemd service for auto-start
 *
 * @example
 * ```typescript
 * const agent = new OpenClawAgent("my-agent", {
 *   anthropicApiKey: config.requireSecret("anthropicApiKey"),
 *   tailscaleAuthKey: config.requireSecret("tailscaleAuthKey"),
 *   tailnetDnsName: config.require("tailnetDnsName"),
 * });
 *
 * export const url = agent.tailscaleUrl;
 * ```
 */
export class OpenClawAgent extends pulumi.ComponentResource {
  /** EC2 instance public IP */
  public readonly publicIp: pulumi.Output<string>;
  /** EC2 instance public DNS */
  public readonly publicDns: pulumi.Output<string>;
  /** Tailscale URL with authentication token */
  public readonly tailscaleUrl: pulumi.Output<string>;
  /** Gateway authentication token */
  public readonly gatewayToken: pulumi.Output<string>;
  /** SSH private key (Ed25519) */
  public readonly sshPrivateKey: pulumi.Output<string>;
  /** SSH public key */
  public readonly sshPublicKey: pulumi.Output<string>;
  /** EC2 instance ID */
  public readonly instanceId: pulumi.Output<string>;
  /** VPC ID */
  public readonly vpcId: pulumi.Output<string>;
  /** Subnet ID */
  public readonly subnetId: pulumi.Output<string>;
  /** Security Group ID */
  public readonly securityGroupId: pulumi.Output<string>;

  constructor(
    name: string,
    args: OpenClawAgentArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("agent-army:aws:OpenClawAgent", name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

    // Defaults
    const instanceType = args.instanceType ?? "t3.medium";
    const gatewayPort = args.gatewayPort ?? 18789;
    const browserPort = args.browserPort ?? 18791;
    const volumeSize = args.volumeSize ?? 30;
    const model = args.model ?? "anthropic/claude-sonnet-4";
    const enableSandbox = args.enableSandbox ?? true;
    const baseTags = args.tags ?? {};

    // Generate SSH key pair
    const sshKey = new tls.PrivateKey(
      `${name}-ssh-key`,
      {
        algorithm: "ED25519",
      },
      defaultResourceOptions
    );

    // Generate gateway token from a separate TLS key
    const tokenKey = new tls.PrivateKey(
      `${name}-gateway-token-key`,
      {
        algorithm: "ED25519",
      },
      defaultResourceOptions
    );

    const gatewayTokenValue = tokenKey.publicKeyOpenssh.apply((key) => {
      const hash = crypto.createHash("sha256").update(key).digest("hex");
      return hash.substring(0, 48);
    });

    // VPC - create or use existing
    let vpcId: pulumi.Output<string>;
    let internetGateway: aws.ec2.InternetGateway | undefined;

    if (args.vpcId) {
      vpcId = pulumi.output(args.vpcId);
    } else {
      const vpc = new aws.ec2.Vpc(
        `${name}-vpc`,
        {
          cidrBlock: "10.0.0.0/16",
          enableDnsHostnames: true,
          enableDnsSupport: true,
          tags: pulumi.output(baseTags).apply((tags) => ({
            ...tags,
            Name: `${name}-vpc`,
          })),
        },
        defaultResourceOptions
      );
      vpcId = vpc.id;

      internetGateway = new aws.ec2.InternetGateway(
        `${name}-igw`,
        {
          vpcId: vpc.id,
          tags: pulumi.output(baseTags).apply((tags) => ({
            ...tags,
            Name: `${name}-igw`,
          })),
        },
        defaultResourceOptions
      );
    }

    // Subnet - create or use existing
    let subnetId: pulumi.Output<string>;

    if (args.subnetId) {
      subnetId = pulumi.output(args.subnetId);
    } else {
      const subnet = new aws.ec2.Subnet(
        `${name}-subnet`,
        {
          vpcId: vpcId,
          cidrBlock: "10.0.1.0/24",
          mapPublicIpOnLaunch: true,
          tags: pulumi.output(baseTags).apply((tags) => ({
            ...tags,
            Name: `${name}-subnet`,
          })),
        },
        defaultResourceOptions
      );
      subnetId = subnet.id;

      // Create route table only if we created the VPC
      if (internetGateway) {
        const routeTable = new aws.ec2.RouteTable(
          `${name}-rt`,
          {
            vpcId: vpcId,
            routes: [
              {
                cidrBlock: "0.0.0.0/0",
                gatewayId: internetGateway.id,
              },
            ],
            tags: pulumi.output(baseTags).apply((tags) => ({
              ...tags,
              Name: `${name}-rt`,
            })),
          },
          defaultResourceOptions
        );

        new aws.ec2.RouteTableAssociation(
          `${name}-rta`,
          {
            subnetId: subnet.id,
            routeTableId: routeTable.id,
          },
          defaultResourceOptions
        );
      }
    }

    // Security Group - create or use existing
    let securityGroupId: pulumi.Output<string>;

    if (args.securityGroupId) {
      securityGroupId = pulumi.output(args.securityGroupId);
    } else {
      const securityGroup = new aws.ec2.SecurityGroup(
        `${name}-sg`,
        {
          vpcId: vpcId,
          description: `Security group for OpenClaw agent ${name}`,
          ingress: [
            {
              description: "SSH access (fallback for Tailscale)",
              fromPort: 22,
              toPort: 22,
              protocol: "tcp",
              cidrBlocks: ["0.0.0.0/0"],
            },
          ],
          egress: [
            {
              fromPort: 0,
              toPort: 0,
              protocol: "-1",
              cidrBlocks: ["0.0.0.0/0"],
            },
          ],
          tags: pulumi.output(baseTags).apply((tags) => ({
            ...tags,
            Name: `${name}-sg`,
          })),
        },
        defaultResourceOptions
      );
      securityGroupId = securityGroup.id;
    }

    // Create EC2 key pair
    const keyPair = new aws.ec2.KeyPair(
      `${name}-keypair`,
      {
        publicKey: sshKey.publicKeyOpenssh,
        tags: pulumi.output(baseTags).apply((tags) => ({
          ...tags,
          Name: `${name}-keypair`,
        })),
      },
      defaultResourceOptions
    );

    // Get Ubuntu 24.04 AMI
    const ami = aws.ec2.getAmiOutput(
      {
        owners: ["099720109477"], // Canonical
        mostRecent: true,
        filters: [
          {
            name: "name",
            values: [
              "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*",
            ],
          },
          { name: "virtualization-type", values: ["hvm"] },
        ],
      },
      defaultResourceOptions
    );

    // Generate cloud-init user data
    // Resolve optional tokens to outputs
    const slackBotTokenOutput = args.slackBotToken 
      ? pulumi.output(args.slackBotToken) 
      : pulumi.output("");
    const slackAppTokenOutput = args.slackAppToken 
      ? pulumi.output(args.slackAppToken) 
      : pulumi.output("");
    const linearApiKeyOutput = args.linearApiKey 
      ? pulumi.output(args.linearApiKey) 
      : pulumi.output("");
    const braveSearchApiKeyOutput = args.braveSearchApiKey 
      ? pulumi.output(args.braveSearchApiKey) 
      : pulumi.output("");

    const userData = pulumi
      .all([
        args.tailscaleAuthKey,
        args.anthropicApiKey,
        gatewayTokenValue,
        slackBotTokenOutput,
        slackAppTokenOutput,
        linearApiKeyOutput,
        braveSearchApiKeyOutput,
      ])
      .apply(
        ([
          tsAuthKey,
          apiKey,
          gwToken,
          slackBotToken,
          slackAppToken,
          linearApiKey,
          braveSearchApiKey,
        ]) => {
          const cloudInitConfig: CloudInitConfig = {
            anthropicApiKey: apiKey,
            tailscaleAuthKey: tsAuthKey,
            gatewayToken: gwToken,
            gatewayPort: gatewayPort as number,
            browserPort: browserPort as number,
            model: model as string,
            enableSandbox: enableSandbox as boolean,
            tailscaleHostname: name,
            workspaceFiles: args.workspaceFiles,
            envVars: args.envVars,
            postSetupCommands: args.postSetupCommands,
            // Slack config (only if both tokens provided)
            slack: slackBotToken && slackAppToken
              ? { botToken: slackBotToken, appToken: slackAppToken }
              : undefined,
            // Linear config (only if API key provided)
            linear: linearApiKey ? { apiKey: linearApiKey } : undefined,
            // Brave Search API key
            braveSearchApiKey: braveSearchApiKey || undefined,
          };

          const script = generateCloudInit(cloudInitConfig);
          return interpolateCloudInit(script, {
            anthropicApiKey: apiKey,
            tailscaleAuthKey: tsAuthKey,
            gatewayToken: gwToken,
            slackBotToken: slackBotToken || undefined,
            slackAppToken: slackAppToken || undefined,
            linearApiKey: linearApiKey || undefined,
            braveSearchApiKey: braveSearchApiKey || undefined,
          });
        }
      );

    // Create EC2 instance
    const instance = new aws.ec2.Instance(
      `${name}-instance`,
      {
        ami: ami.id,
        instanceType: instanceType,
        subnetId: subnetId,
        vpcSecurityGroupIds: [securityGroupId],
        keyName: keyPair.keyName,
        userData: userData,
        userDataReplaceOnChange: true,
        rootBlockDevice: {
          volumeSize: volumeSize,
          volumeType: "gp3",
        },
        tags: pulumi.output(baseTags).apply((tags) => ({
          ...tags,
          Name: name,
          Component: "openclaw-agent",
        })),
      },
      defaultResourceOptions
    );

    // Set outputs
    this.publicIp = instance.publicIp;
    this.publicDns = instance.publicDns;
    this.instanceId = instance.id;
    this.vpcId = vpcId;
    this.subnetId = subnetId;
    this.securityGroupId = securityGroupId;
    this.sshPrivateKey = sshKey.privateKeyOpenssh;
    this.sshPublicKey = sshKey.publicKeyOpenssh;
    this.gatewayToken = gatewayTokenValue;
    // Tailscale hostname is set to the agent name via --hostname flag in cloud-init
    this.tailscaleUrl = pulumi.interpolate`https://${name}.${args.tailnetDnsName}/?token=${gatewayTokenValue}`;

    // Register outputs
    this.registerOutputs({
      publicIp: this.publicIp,
      publicDns: this.publicDns,
      tailscaleUrl: this.tailscaleUrl,
      gatewayToken: this.gatewayToken,
      sshPrivateKey: this.sshPrivateKey,
      sshPublicKey: this.sshPublicKey,
      instanceId: this.instanceId,
      vpcId: this.vpcId,
      subnetId: this.subnetId,
      securityGroupId: this.securityGroupId,
    });
  }
}
