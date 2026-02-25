/**
 * OpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on AWS EC2
 */
import * as pulumi from "@pulumi/pulumi";
import type { BaseOpenClawAgentArgs } from "./types";
/**
 * Arguments for creating an OpenClaw Agent
 */
export interface OpenClawAgentArgs extends BaseOpenClawAgentArgs {
    /**
     * EC2 instance type (default: t3.medium)
     * WARNING: Do not use t3.micro - 1GB memory is insufficient
     */
    instanceType?: pulumi.Input<string>;
    /** Existing VPC ID. If not provided, creates a new VPC */
    vpcId?: pulumi.Input<string>;
    /** Existing Subnet ID. If not provided, creates a new subnet */
    subnetId?: pulumi.Input<string>;
    /** Existing Security Group ID. If not provided, creates one */
    securityGroupId?: pulumi.Input<string>;
    /** EBS root volume size in GB (default: 30) */
    volumeSize?: pulumi.Input<number>;
    /** Additional tags to apply to all resources */
    tags?: pulumi.Input<Record<string, pulumi.Input<string>>>;
    /** AWS region (uses default provider region if not specified) */
    region?: pulumi.Input<string>;
    /**
     * CIDR blocks allowed SSH access (default: none — use Tailscale).
     * Only applies when creating a new security group (no securityGroupId provided).
     * Example: ["1.2.3.4/32"] to restrict to your IP only.
     */
    allowedSshCidrs?: pulumi.Input<pulumi.Input<string>[]>;
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
export declare class OpenClawAgent extends pulumi.ComponentResource {
    /** EC2 instance public IP */
    readonly publicIp: pulumi.Output<string>;
    /** EC2 instance public DNS */
    readonly publicDns: pulumi.Output<string>;
    /** Tailscale URL with authentication token */
    readonly tailscaleUrl: pulumi.Output<string>;
    /** Gateway authentication token */
    readonly gatewayToken: pulumi.Output<string>;
    /** SSH private key (Ed25519) */
    readonly sshPrivateKey: pulumi.Output<string>;
    /** SSH public key */
    readonly sshPublicKey: pulumi.Output<string>;
    /** EC2 instance ID */
    readonly instanceId: pulumi.Output<string>;
    /** VPC ID */
    readonly vpcId: pulumi.Output<string>;
    /** Subnet ID */
    readonly subnetId: pulumi.Output<string>;
    /** Security Group ID */
    readonly securityGroupId: pulumi.Output<string>;
    constructor(name: string, args: OpenClawAgentArgs, opts?: pulumi.ComponentResourceOptions);
}
//# sourceMappingURL=openclaw-agent.d.ts.map