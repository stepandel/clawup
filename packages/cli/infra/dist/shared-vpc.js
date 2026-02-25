"use strict";
/**
 * Shared VPC Component for Multi-Agent Deployments
 *
 * Creates a single VPC with subnet, internet gateway, and security group
 * that can be shared across multiple OpenClaw agent instances for cost optimization.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedVpc = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const aws = __importStar(require("@pulumi/aws"));
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
class SharedVpc extends pulumi.ComponentResource {
    /** VPC ID */
    vpcId;
    /** Subnet ID */
    subnetId;
    /** Security Group ID */
    securityGroupId;
    /** Internet Gateway ID */
    internetGatewayId;
    constructor(name, args = {}, opts) {
        super("clawup:aws:SharedVpc", name, {}, opts);
        const defaultResourceOptions = { parent: this };
        const cidrBlock = args.cidrBlock ?? "10.0.0.0/16";
        const subnetCidrBlock = args.subnetCidrBlock ?? "10.0.1.0/24";
        const availabilityZone = args.availabilityZone ?? "us-east-1a";
        const baseTags = args.tags ?? {};
        // Create VPC
        const vpc = new aws.ec2.Vpc(`${name}-vpc`, {
            cidrBlock: cidrBlock,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            tags: pulumi.output(baseTags).apply((tags) => ({
                ...tags,
                Name: `${name}-vpc`,
            })),
        }, defaultResourceOptions);
        // Create Internet Gateway
        const internetGateway = new aws.ec2.InternetGateway(`${name}-igw`, {
            vpcId: vpc.id,
            tags: pulumi.output(baseTags).apply((tags) => ({
                ...tags,
                Name: `${name}-igw`,
            })),
        }, defaultResourceOptions);
        // Create public subnet
        const subnet = new aws.ec2.Subnet(`${name}-subnet`, {
            vpcId: vpc.id,
            cidrBlock: subnetCidrBlock,
            availabilityZone: availabilityZone,
            mapPublicIpOnLaunch: true,
            tags: pulumi.output(baseTags).apply((tags) => ({
                ...tags,
                Name: `${name}-subnet`,
            })),
        }, defaultResourceOptions);
        // Create route table with internet route
        const routeTable = new aws.ec2.RouteTable(`${name}-rt`, {
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
        }, defaultResourceOptions);
        // Associate route table with subnet
        new aws.ec2.RouteTableAssociation(`${name}-rta`, {
            subnetId: subnet.id,
            routeTableId: routeTable.id,
        }, defaultResourceOptions);
        // Create security group
        const securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
            vpcId: vpc.id,
            description: `Shared security group for ${name} agent fleet`,
            // SSH is disabled by default — Tailscale is the primary access method.
            // Pass allowedSshCidrs to enable SSH from specific IPs as a fallback.
            ingress: pulumi
                .output(args.allowedSshCidrs ?? [])
                .apply((cidrs) => cidrs.length > 0
                ? [
                    {
                        description: "SSH access (restricted)",
                        fromPort: 22,
                        toPort: 22,
                        protocol: "tcp",
                        cidrBlocks: cidrs,
                    },
                ]
                : []),
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
        }, defaultResourceOptions);
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
exports.SharedVpc = SharedVpc;
//# sourceMappingURL=shared-vpc.js.map