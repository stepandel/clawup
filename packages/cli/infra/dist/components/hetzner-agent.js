"use strict";
/**
 * HetznerOpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on Hetzner Cloud
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
exports.HetznerOpenClawAgent = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const hcloud = __importStar(require("@pulumi/hcloud"));
const shared_1 = require("./shared");
/**
 * HetznerOpenClaw Agent ComponentResource
 *
 * Provisions a complete OpenClaw agent on Hetzner Cloud including:
 * - SSH key for access
 * - Firewall allowing only SSH inbound
 * - Server with Ubuntu 24.04
 * - Docker, Node.js 22, and OpenClaw installation
 * - Tailscale for secure HTTPS access
 * - Systemd service for auto-start
 *
 * @example
 * ```typescript
 * const agent = new HetznerOpenClawAgent("my-agent", {
 *   anthropicApiKey: config.requireSecret("anthropicApiKey"),
 *   tailscaleAuthKey: config.requireSecret("tailscaleAuthKey"),
 *   tailnetDnsName: config.require("tailnetDnsName"),
 * });
 *
 * export const url = agent.tailscaleUrl;
 * ```
 */
class HetznerOpenClawAgent extends pulumi.ComponentResource {
    /** Server public IP (IPv4) */
    publicIp;
    /** Tailscale URL with authentication token */
    tailscaleUrl;
    /** Gateway authentication token */
    gatewayToken;
    /** SSH private key (Ed25519) */
    sshPrivateKey;
    /** SSH public key */
    sshPublicKey;
    /** Hetzner server ID */
    serverId;
    /** Firewall ID */
    firewallId;
    constructor(name, args, opts) {
        super("clawup:hetzner:HetznerOpenClawAgent", name, {}, opts);
        const defaultResourceOptions = { parent: this };
        // Defaults
        const serverType = args.serverType ?? "cx22";
        const location = args.location ?? "nbg1";
        const baseLabels = args.labels ?? {};
        // Generate SSH key pair + gateway token
        const { sshKey, gatewayTokenValue } = (0, shared_1.generateKeyPairAndToken)(name, defaultResourceOptions);
        // Create Hetzner SSH key
        const hcloudSshKey = new hcloud.SshKey(`${name}-sshkey`, {
            publicKey: sshKey.publicKeyOpenssh,
            labels: pulumi.output(baseLabels).apply((labels) => ({
                ...labels,
                name: name,
            })),
        }, defaultResourceOptions);
        // Create firewall allowing only SSH inbound
        const firewall = new hcloud.Firewall(`${name}-firewall`, {
            labels: pulumi.output(baseLabels).apply((labels) => ({
                ...labels,
                name: name,
            })),
            // Only add SSH rule if allowedSshIps is explicitly provided
            // Tailscale is the primary access method; SSH is optional fallback
            rules: pulumi
                .output(args.allowedSshIps ?? [])
                .apply((ips) => ips.length > 0
                ? [
                    {
                        direction: "in",
                        protocol: "tcp",
                        port: "22",
                        sourceIps: ips,
                        description: "SSH access (restricted)",
                    },
                ]
                : []),
        }, defaultResourceOptions);
        // Generate cloud-init user data (compressed for Hetzner's 32KB limit)
        const userData = (0, shared_1.buildCloudInitUserData)(name, args, gatewayTokenValue, {
            createUbuntuUser: true,
            compress: true,
        });
        // Create Hetzner server
        const server = new hcloud.Server(`${name}-server`, {
            serverType: serverType,
            image: "ubuntu-24.04",
            location: location,
            sshKeys: [hcloudSshKey.id],
            firewallIds: [firewall.id.apply((id) => parseInt(id, 10))],
            userData: userData,
            labels: pulumi.output(baseLabels).apply((labels) => ({
                ...labels,
                name: name,
                component: "openclaw-agent",
            })),
        }, defaultResourceOptions);
        // Set outputs
        this.publicIp = server.ipv4Address;
        this.serverId = server.id;
        this.firewallId = firewall.id;
        this.sshPrivateKey = pulumi.secret(sshKey.privateKeyOpenssh);
        this.sshPublicKey = sshKey.publicKeyOpenssh;
        this.gatewayToken = pulumi.secret(gatewayTokenValue);
        // Tailscale hostname includes stack name to avoid conflicts (e.g., dev-agent-pm)
        const tsHostname = `${pulumi.getStack()}-${name}`;
        this.tailscaleUrl = pulumi.secret(pulumi.interpolate `https://${tsHostname}.${args.tailnetDnsName}/?token=${gatewayTokenValue}`);
        // Register outputs
        this.registerOutputs({
            publicIp: this.publicIp,
            tailscaleUrl: this.tailscaleUrl,
            gatewayToken: this.gatewayToken,
            sshPrivateKey: this.sshPrivateKey,
            sshPublicKey: this.sshPublicKey,
            serverId: this.serverId,
            firewallId: this.firewallId,
        });
    }
}
exports.HetznerOpenClawAgent = HetznerOpenClawAgent;
//# sourceMappingURL=hetzner-agent.js.map