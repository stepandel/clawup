/**
 * Shared VPC Component for Multi-Agent Deployments
 *
 * Creates a single VPC with subnet, internet gateway, and security group
 * that can be shared across multiple OpenClaw agent instances for cost optimization.
 */

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface SharedVpcArgs {
  /**
   * CIDR block for the VPC (default: "10.0.0.0/16")
   */
  cidrBlock?: pulumi.Input<string>;

  /**
   * CIDR block for the subnet (default: "10.0.1.0/24")
   */
  subnetCidrBlock?: pulumi.Input<string>;

  /**
   * Availability zone for the subnet (default: "us-east-1a")
   */
  availabilityZone?: pulumi.Input<string>;

  /**
   * CIDR blocks allowed SSH access (default: none — use Tailscale).
   * Example: ["1.2.3.4/32"] to restrict to your IP only.
   */
  allowedSshCidrs?: pulumi.Input<pulumi.Input<string>[]>;

  /**
   * Additional tags to apply to all resources
   */
  tags?: pulumi.Input<Record<string, pulumi.Input<string>>>;
}

/**
 * SharedVpc ComponentResource
 *
 * Creates shared networking infrastructure for multiple OpenClaw agents:
 * - VPC with DNS support
 * - Public subnet with auto-assign public IP
 * - Internet gateway for outbound access
 * - Route table with internet route
 * - Security group allowing SSH and all outbound traffic
 */
export class SharedVpc extends pulumi.ComponentResource {
  /** VPC ID */
  public readonly vpcId: pulumi.Output<string>;
  /** Subnet ID */
  public readonly subnetId: pulumi.Output<string>;
  /** Security Group ID */
  public readonly securityGroupId: pulumi.Output<string>;
  /** Internet Gateway ID */
  public readonly internetGatewayId: pulumi.Output<string>;

  constructor(
    name: string,
    args: SharedVpcArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("agent-army:aws:SharedVpc", name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
    const cidrBlock = args.cidrBlock ?? "10.0.0.0/16";
    const subnetCidrBlock = args.subnetCidrBlock ?? "10.0.1.0/24";
    const availabilityZone = args.availabilityZone ?? "us-east-1a";
    const baseTags = args.tags ?? {};

    // Create VPC
    const vpc = new aws.ec2.Vpc(
      `${name}-vpc`,
      {
        cidrBlock: cidrBlock,
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: pulumi.output(baseTags).apply((tags) => ({
          ...tags,
          Name: `${name}-vpc`,
        })),
      },
      defaultResourceOptions
    );

    // Create Internet Gateway
    const internetGateway = new aws.ec2.InternetGateway(
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

    // Create public subnet
    const subnet = new aws.ec2.Subnet(
      `${name}-subnet`,
      {
        vpcId: vpc.id,
        cidrBlock: subnetCidrBlock,
        availabilityZone: availabilityZone,
        mapPublicIpOnLaunch: true,
        tags: pulumi.output(baseTags).apply((tags) => ({
          ...tags,
          Name: `${name}-subnet`,
        })),
      },
      defaultResourceOptions
    );

    // Create route table with internet route
    const routeTable = new aws.ec2.RouteTable(
      `${name}-rt`,
      {
        vpcId: vpc.id,
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

    // Associate route table with subnet
    new aws.ec2.RouteTableAssociation(
      `${name}-rta`,
      {
        subnetId: subnet.id,
        routeTableId: routeTable.id,
      },
      defaultResourceOptions
    );

    // Create security group
    const securityGroup = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      {
        vpcId: vpc.id,
        description: `Shared security group for ${name} agent fleet`,
        // SSH is disabled by default — Tailscale is the primary access method.
        // Pass allowedSshCidrs to enable SSH from specific IPs as a fallback.
        ingress: pulumi
          .output(args.allowedSshCidrs ?? [])
          .apply((cidrs) =>
            cidrs.length > 0
              ? [
                  {
                    description: "SSH access (restricted)",
                    fromPort: 22,
                    toPort: 22,
                    protocol: "tcp",
                    cidrBlocks: cidrs,
                  },
                ]
              : []
          ),
        egress: [
          {
            description: "All outbound traffic",
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

    // Set outputs
    this.vpcId = vpc.id;
    this.subnetId = subnet.id;
    this.securityGroupId = securityGroup.id;
    this.internetGatewayId = internetGateway.id;

    // Register outputs
    this.registerOutputs({
      vpcId: this.vpcId,
      subnetId: this.subnetId,
      securityGroupId: this.securityGroupId,
      internetGatewayId: this.internetGatewayId,
    });
  }
}
