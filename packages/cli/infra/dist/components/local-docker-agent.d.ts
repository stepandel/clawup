/**
 * LocalDockerOpenClaw Agent - Reusable Pulumi ComponentResource
 * Provisions a single OpenClaw agent in a local Docker container (for testing)
 */
import * as pulumi from "@pulumi/pulumi";
import type { BaseOpenClawAgentArgs } from "./types";
/**
 * Arguments for creating a Local Docker OpenClaw Agent
 */
export interface LocalDockerOpenClawAgentArgs extends BaseOpenClawAgentArgs {
    /**
     * Docker image to use (default: ubuntu:24.04)
     */
    image?: string;
    /**
     * Host port to map the gateway to (required)
     * Each agent needs a unique port.
     */
    gatewayPort: pulumi.Input<number>;
    /** Additional labels to apply to the container */
    labels?: Record<string, string>;
}
/**
 * LocalDockerOpenClaw Agent ComponentResource
 *
 * Provisions an OpenClaw agent in a local Docker container:
 * - Uses same cloud-init script as cloud providers
 * - Skips Docker-in-Docker and Tailscale
 * - Maps gateway port to host for direct access
 * - Runs daemon in foreground to keep container alive
 *
 * @example
 * ```typescript
 * const agent = new LocalDockerOpenClawAgent("my-agent", {
 *   anthropicApiKey: config.requireSecret("anthropicApiKey"),
 *   tailscaleAuthKey: pulumi.secret("not-used"),
 *   tailnetDnsName: "localhost",
 *   gatewayPort: 18789,
 * });
 *
 * export const url = agent.gatewayUrl;
 * ```
 */
export declare class LocalDockerOpenClawAgent extends pulumi.ComponentResource {
    /** Always "127.0.0.1" for local Docker */
    readonly publicIp: pulumi.Output<string>;
    /** Gateway URL (http://localhost:<port>/?token=...) */
    readonly tailscaleUrl: pulumi.Output<string>;
    /** Gateway authentication token */
    readonly gatewayToken: pulumi.Output<string>;
    /** SSH private key (Ed25519) — not used for local but kept for interface compat */
    readonly sshPrivateKey: pulumi.Output<string>;
    /** SSH public key */
    readonly sshPublicKey: pulumi.Output<string>;
    /** Docker container ID */
    readonly containerId: pulumi.Output<string>;
    /** Docker container name */
    readonly containerName: pulumi.Output<string>;
    constructor(name: string, args: LocalDockerOpenClawAgentArgs, opts?: pulumi.ComponentResourceOptions);
}
//# sourceMappingURL=local-docker-agent.d.ts.map