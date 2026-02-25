"use strict";
/**
 * OpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on AWS EC2
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
exports.OpenClawAgent = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const aws = __importStar(require("@pulumi/aws"));
const zlib = __importStar(require("zlib"));
const shared_1 = require("./shared");
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
class OpenClawAgent extends pulumi.ComponentResource {
    /** EC2 instance public IP */
    publicIp;
    /** EC2 instance public DNS */
    publicDns;
    /** Tailscale URL with authentication token */
    tailscaleUrl;
    /** Gateway authentication token */
    gatewayToken;
    /** SSH private key (Ed25519) */
    sshPrivateKey;
    /** SSH public key */
    sshPublicKey;
    /** EC2 instance ID */
    instanceId;
    /** VPC ID */
    vpcId;
    /** Subnet ID */
    subnetId;
    /** Security Group ID */
    securityGroupId;
    constructor(name, args, opts) {
        super("clawup:aws:OpenClawAgent", name, {}, opts);
        const defaultResourceOptions = { parent: this };
        // Defaults
        const instanceType = args.instanceType ?? "t3.medium";
        const gatewayPort = args.gatewayPort ?? 18789;
        const browserPort = args.browserPort ?? 18791;
        const volumeSize = args.volumeSize ?? 30;
        const model = args.model ?? "anthropic/claude-opus-4-6";
        const enableSandbox = args.enableSandbox ?? true;
        const baseTags = args.tags ?? {};
        // Generate SSH key pair + gateway token
        const { sshKey, gatewayTokenValue } = (0, shared_1.generateKeyPairAndToken)(name, defaultResourceOptions);
        // VPC - create or use existing
        let vpcId;
        let internetGateway;
        if (args.vpcId) {
            vpcId = pulumi.output(args.vpcId);
        }
        else {
            const vpc = new aws.ec2.Vpc(`${name}-vpc`, {
                cidrBlock: "10.0.0.0/16",
                enableDnsHostnames: true,
                enableDnsSupport: true,
                tags: pulumi.output(baseTags).apply((tags) => ({
                    ...tags,
                    Name: `${name}-vpc`,
                })),
            }, defaultResourceOptions);
            vpcId = vpc.id;
            internetGateway = new aws.ec2.InternetGateway(`${name}-igw`, {
                vpcId: vpc.id,
                tags: pulumi.output(baseTags).apply((tags) => ({
                    ...tags,
                    Name: `${name}-igw`,
                })),
            }, defaultResourceOptions);
        }
        // Subnet - create or use existing
        let subnetId;
        if (args.subnetId) {
            subnetId = pulumi.output(args.subnetId);
        }
        else {
            const subnet = new aws.ec2.Subnet(`${name}-subnet`, {
                vpcId: vpcId,
                cidrBlock: "10.0.1.0/24",
                mapPublicIpOnLaunch: true,
                tags: pulumi.output(baseTags).apply((tags) => ({
                    ...tags,
                    Name: `${name}-subnet`,
                })),
            }, defaultResourceOptions);
            subnetId = subnet.id;
            // Create route table only if we created the VPC
            if (internetGateway) {
                const routeTable = new aws.ec2.RouteTable(`${name}-rt`, {
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
                }, defaultResourceOptions);
                new aws.ec2.RouteTableAssociation(`${name}-rta`, {
                    subnetId: subnet.id,
                    routeTableId: routeTable.id,
                }, defaultResourceOptions);
            }
        }
        // Security Group - create or use existing
        let securityGroupId;
        if (args.securityGroupId) {
            securityGroupId = pulumi.output(args.securityGroupId);
        }
        else {
            const securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
                vpcId: vpcId,
                description: `Security group for OpenClaw agent ${name}`,
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
            securityGroupId = securityGroup.id;
        }
        // Create EC2 key pair
        const keyPair = new aws.ec2.KeyPair(`${name}-keypair`, {
            publicKey: sshKey.publicKeyOpenssh,
            tags: pulumi.output(baseTags).apply((tags) => ({
                ...tags,
                Name: `${name}-keypair`,
            })),
        }, defaultResourceOptions);
        // Get Ubuntu 24.04 AMI
        const ami = aws.ec2.getAmiOutput({
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
        }, defaultResourceOptions);
        // Generate cloud-init user data
        const userData = (0, shared_1.buildCloudInitUserData)(name, args, gatewayTokenValue, {
            gatewayPort: gatewayPort,
            browserPort: browserPort,
            model: model,
            enableSandbox: enableSandbox,
        });
        // Create EC2 instance
        const instance = new aws.ec2.Instance(`${name}-instance`, {
            ami: ami.id,
            instanceType: instanceType,
            subnetId: subnetId,
            vpcSecurityGroupIds: [securityGroupId],
            keyName: keyPair.keyName,
            userDataBase64: userData.apply((script) => {
                const gzipped = zlib.gzipSync(Buffer.from(script));
                return gzipped.toString("base64");
            }),
            userDataReplaceOnChange: true,
            // Enforce IMDSv2 to prevent unauthenticated metadata access
            metadataOptions: {
                httpTokens: "required",
                httpEndpoint: "enabled",
                httpPutResponseHopLimit: 2,
            },
            rootBlockDevice: {
                volumeSize: volumeSize,
                volumeType: "gp3",
            },
            tags: pulumi.output(baseTags).apply((tags) => ({
                ...tags,
                Name: name,
                Component: "openclaw-agent",
            })),
        }, defaultResourceOptions);
        // Set outputs
        this.publicIp = instance.publicIp;
        this.publicDns = instance.publicDns;
        this.instanceId = instance.id;
        this.vpcId = vpcId;
        this.subnetId = subnetId;
        this.securityGroupId = securityGroupId;
        this.sshPrivateKey = pulumi.secret(sshKey.privateKeyOpenssh);
        this.sshPublicKey = sshKey.publicKeyOpenssh;
        this.gatewayToken = pulumi.secret(gatewayTokenValue);
        // Tailscale hostname includes stack name to avoid conflicts (e.g., dev-agent-pm)
        const tsHostname = `${pulumi.getStack()}-${name}`;
        this.tailscaleUrl = pulumi.secret(pulumi.interpolate `https://${tsHostname}.${args.tailnetDnsName}/?token=${gatewayTokenValue}`);
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
exports.OpenClawAgent = OpenClawAgent;
//# sourceMappingURL=openclaw-agent.js.map