/**
 * Shared VPC Component for Multi-Agent Deployments
 *
 * Creates a single VPC with subnet, internet gateway, and security group
 * that can be shared across multiple OpenClaw agent instances for cost optimization.
 */
import * as pulumi from "@pulumi/pulumi";
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
export declare class SharedVpc extends pulumi.ComponentResource {
    /** VPC ID */
    readonly vpcId: pulumi.Output<string>;
    /** Subnet ID */
    readonly subnetId: pulumi.Output<string>;
    /** Security Group ID */
    readonly securityGroupId: pulumi.Output<string>;
    /** Internet Gateway ID */
    readonly internetGatewayId: pulumi.Output<string>;
    constructor(name: string, args?: SharedVpcArgs, opts?: pulumi.ComponentResourceOptions);
}
//# sourceMappingURL=shared-vpc.d.ts.map