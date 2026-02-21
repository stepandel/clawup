/**
 * HetznerOpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on Hetzner Cloud
 */

import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import type { BaseOpenClawAgentArgs } from "./types";
import { generateKeyPairAndToken, buildCloudInitUserData } from "./shared";

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
export class HetznerOpenClawAgent extends pulumi.ComponentResource {
  /** Server public IP (IPv4) */
  public readonly publicIp: pulumi.Output<string>;
  /** Tailscale URL with authentication token */
  public readonly tailscaleUrl: pulumi.Output<string>;
  /** Gateway authentication token */
  public readonly gatewayToken: pulumi.Output<string>;
  /** SSH private key (Ed25519) */
  public readonly sshPrivateKey: pulumi.Output<string>;
  /** SSH public key */
  public readonly sshPublicKey: pulumi.Output<string>;
  /** Hetzner server ID */
  public readonly serverId: pulumi.Output<string>;
  /** Firewall ID */
  public readonly firewallId: pulumi.Output<string>;

  constructor(
    name: string,
    args: HetznerOpenClawAgentArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("clawup:hetzner:HetznerOpenClawAgent", name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

    // Defaults
    const serverType = args.serverType ?? "cx22";
    const location = args.location ?? "nbg1";
    const baseLabels = args.labels ?? {};

    // Generate SSH key pair + gateway token
    const { sshKey, gatewayTokenValue } = generateKeyPairAndToken(name, defaultResourceOptions);

    // Create Hetzner SSH key
    const hcloudSshKey = new hcloud.SshKey(
      `${name}-sshkey`,
      {
        publicKey: sshKey.publicKeyOpenssh,
        labels: pulumi.output(baseLabels).apply((labels) => ({
          ...labels,
          name: name,
        })),
      },
      defaultResourceOptions
    );

    // Create firewall allowing only SSH inbound
    const firewall = new hcloud.Firewall(
      `${name}-firewall`,
      {
        labels: pulumi.output(baseLabels).apply((labels) => ({
          ...labels,
          name: name,
        })),
        // Only add SSH rule if allowedSshIps is explicitly provided
        // Tailscale is the primary access method; SSH is optional fallback
        rules: pulumi
          .output(args.allowedSshIps ?? [])
          .apply((ips) =>
            ips.length > 0
              ? [
                  {
                    direction: "in",
                    protocol: "tcp",
                    port: "22",
                    sourceIps: ips,
                    description: "SSH access (restricted)",
                  },
                ]
              : []
          ),
      },
      defaultResourceOptions
    );

    // Generate cloud-init user data (compressed for Hetzner's 32KB limit)
    const userData = buildCloudInitUserData(name, args, gatewayTokenValue, {
      createUbuntuUser: true,
      compress: true,
    });

    // Create Hetzner server
    const server = new hcloud.Server(
      `${name}-server`,
      {
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
      },
      defaultResourceOptions
    );

    // Set outputs
    this.publicIp = server.ipv4Address;
    this.serverId = server.id;
    this.firewallId = firewall.id;
    this.sshPrivateKey = pulumi.secret(sshKey.privateKeyOpenssh);
    this.sshPublicKey = sshKey.publicKeyOpenssh;
    this.gatewayToken = pulumi.secret(gatewayTokenValue);

    // Tailscale hostname includes stack name to avoid conflicts (e.g., dev-agent-pm)
    const tsHostname = `${pulumi.getStack()}-${name}`;
    this.tailscaleUrl = pulumi.secret(pulumi.interpolate`https://${tsHostname}.${args.tailnetDnsName}/?token=${gatewayTokenValue}`);

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
