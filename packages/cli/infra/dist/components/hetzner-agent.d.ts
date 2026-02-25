/**
 * HetznerOpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on Hetzner Cloud
 */
import * as pulumi from "@pulumi/pulumi";
import type { BaseOpenClawAgentArgs } from "./types";
/**
 * Arguments for creating a Hetzner OpenClaw Agent
 */
export interface HetznerOpenClawAgentArgs extends BaseOpenClawAgentArgs {
    /**
     * Hetzner server type (default: cx22)
     * cx22 = 2 vCPUs, 4GB RAM - recommended minimum
     */
    serverType?: pulumi.Input<string>;
    /**
     * Hetzner datacenter location (default: nbg1)
     * Options: nbg1, fsn1, hel1, ash, hil
     */
    location?: pulumi.Input<string>;
    /**
     * Allowed SSH source IPs (optional)
     * If not provided, SSH rule is not added (Tailscale is primary access)
     * Example: ["1.2.3.4/32", "10.0.0.0/8"]
     */
    allowedSshIps?: pulumi.Input<string[]>;
    /** Additional labels to apply to all resources */
    labels?: pulumi.Input<Record<string, pulumi.Input<string>>>;
}
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
export declare class HetznerOpenClawAgent extends pulumi.ComponentResource {
    /** Server public IP (IPv4) */
    readonly publicIp: pulumi.Output<string>;
    /** Tailscale URL with authentication token */
    readonly tailscaleUrl: pulumi.Output<string>;
    /** Gateway authentication token */
    readonly gatewayToken: pulumi.Output<string>;
    /** SSH private key (Ed25519) */
    readonly sshPrivateKey: pulumi.Output<string>;
    /** SSH public key */
    readonly sshPublicKey: pulumi.Output<string>;
    /** Hetzner server ID */
    readonly serverId: pulumi.Output<string>;
    /** Firewall ID */
    readonly firewallId: pulumi.Output<string>;
    constructor(name: string, args: HetznerOpenClawAgentArgs, opts?: pulumi.ComponentResourceOptions);
}
//# sourceMappingURL=hetzner-agent.d.ts.map