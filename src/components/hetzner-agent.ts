/**
 * HetznerOpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent on Hetzner Cloud
 */

import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import * as tls from "@pulumi/tls";
import * as crypto from "crypto";
import { generateCloudInit, interpolateCloudInit, compressCloudInit, CloudInitConfig, PluginInstallConfig } from "./cloud-init";

/**
 * Arguments for creating a Hetzner OpenClaw Agent
 */
export interface HetznerOpenClawAgentArgs {
  /**
   * Hetzner server type (default: cx22)
   * cx22 = 2 vCPUs, 4GB RAM - recommended minimum
   */
  serverType?: pulumi.Input<string>;

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
   * Hetzner datacenter location (default: nbg1)
   * Options: nbg1, fsn1, hel1, ash, hil
   */
  location?: pulumi.Input<string>;

  /**
   * AI model to use (default: anthropic/claude-opus-4-6)
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
   * Allowed SSH source IPs (optional)
   * If not provided, SSH rule is not added (Tailscale is primary access)
   * Example: ["1.2.3.4/32", "10.0.0.0/8"]
   */
  allowedSshIps?: pulumi.Input<string[]>;

  /**
   * Browser control port (default: 18791)
   */
  browserPort?: pulumi.Input<number>;

  /**
   * Additional labels to apply to all resources
   */
  labels?: pulumi.Input<Record<string, pulumi.Input<string>>>;

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
   * Plugins to install and configure on this agent
   */
  plugins?: PluginInstallConfig[];

  /**
   * Resolved secret values for plugin env vars: { envVarName: pulumiOutput }
   */
  pluginSecrets?: Record<string, pulumi.Input<string>>;

  /**
   * GitHub personal access token for gh CLI authentication
   * Must start with ghp_ or github_pat_
   */
  githubToken?: pulumi.Input<string>;

  /**
   * Brave Search API key for web search
   */
  braveApiKey?: pulumi.Input<string>;

  /**
   * Whether to enable Tailscale Funnel (public HTTPS for webhooks)
   */
  enableFunnel?: boolean;
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
    super("agent-army:hetzner:HetznerOpenClawAgent", name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

    // Defaults
    const serverType = args.serverType ?? "cx22";
    const location = args.location ?? "nbg1";
    const baseLabels = args.labels ?? {};

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

    // Build outputs for plugin secrets
    const pluginSecretEntries = Object.entries(args.pluginSecrets ?? {});
    const pluginSecretOutputs = pluginSecretEntries.map(([, v]) => pulumi.output(v));

    // Resolve optional tokens to outputs
    const githubTokenOutput = args.githubToken
      ? pulumi.output(args.githubToken)
      : pulumi.output("");
    const braveApiKeyOutput = args.braveApiKey
      ? pulumi.output(args.braveApiKey)
      : pulumi.output("");

    // Resolve Input<> values for cloud-init config
    const gatewayPortResolved = pulumi.output(args.gatewayPort ?? 18789);
    const browserPortResolved = pulumi.output(args.browserPort ?? 18791);
    const modelResolved = pulumi.output(args.model ?? "anthropic/claude-opus-4-6");
    const enableSandboxResolved = pulumi.output(args.enableSandbox ?? true);

    // Generate cloud-init user data
    const userData = pulumi
      .all([
        args.tailscaleAuthKey,
        args.anthropicApiKey,
        gatewayTokenValue,
        githubTokenOutput,
        braveApiKeyOutput,
        ...pluginSecretOutputs,
      ])
      .apply(
        ([
          tsAuthKey,
          apiKey,
          gwToken,
          githubToken,
          braveApiKey,
          ...pluginSecretValues
        ]) =>
          pulumi
            .all([gatewayPortResolved, browserPortResolved, modelResolved, enableSandboxResolved])
            .apply(([gatewayPort, browserPort, model, enableSandbox]) => {
              // Include stack name in Tailscale hostname to avoid conflicts across deployments
              const tsHostname = `${pulumi.getStack()}-${name}`;

              // Build additional secrets map from plugin secrets
              const additionalSecrets: Record<string, string> = {};
              pluginSecretEntries.forEach(([envVar], idx) => {
                additionalSecrets[envVar] = pluginSecretValues[idx] as string;
              });

              const cloudInitConfig: CloudInitConfig = {
                anthropicApiKey: apiKey,
                tailscaleAuthKey: tsAuthKey,
                gatewayToken: gwToken,
                gatewayPort: gatewayPort,
                browserPort: browserPort,
                model: model,
                enableSandbox: enableSandbox,
                tailscaleHostname: tsHostname,
                workspaceFiles: args.workspaceFiles,
                envVars: args.envVars,
                postSetupCommands: args.postSetupCommands,
                createUbuntuUser: true, // Hetzner images don't have ubuntu user by default
                // Plugins
                plugins: args.plugins,
                enableFunnel: args.enableFunnel,
                // GitHub token for gh CLI auth
                githubToken: githubToken || undefined,
                // Brave Search API key for web search
                braveApiKey: braveApiKey || undefined,
              };

              const script = generateCloudInit(cloudInitConfig);
              const interpolated = interpolateCloudInit(script, {
                anthropicApiKey: apiKey,
                tailscaleAuthKey: tsAuthKey,
                gatewayToken: gwToken,
                githubToken: githubToken || undefined,
                braveApiKey: braveApiKey || undefined,
                additionalSecrets,
              });
              // Compress to stay within Hetzner's 32KB user_data limit
              return compressCloudInit(interpolated);
            })
      );

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
