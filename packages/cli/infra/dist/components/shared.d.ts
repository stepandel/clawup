/**
 * Shared helpers for OpenClaw agent components (AWS + Hetzner)
 *
 * Extracts the duplicated SSH key generation, gateway token derivation,
 * and cloud-init user data assembly that was identical across providers.
 */
import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import type { BaseOpenClawAgentArgs } from "./types";
/**
 * Generate an SSH key pair and a gateway authentication token.
 * Both providers use the same ED25519 key generation pattern.
 */
export declare function generateKeyPairAndToken(name: string, resourceOptions: pulumi.ResourceOptions): {
    sshKey: tls.PrivateKey;
    gatewayTokenValue: pulumi.Output<string>;
};
/**
 * Resolved defaults that may come from pulumi.Input<> values.
 * Callers should resolve Input<> to concrete values before passing them here.
 */
export interface CloudInitDefaults {
    gatewayPort?: number;
    browserPort?: number;
    model?: string;
    enableSandbox?: boolean;
    createUbuntuUser?: boolean;
    /** Compress output for providers with user_data size limits (e.g., Hetzner 32KB) */
    compress?: boolean;
    /** Skip Docker installation (for local Docker provider) */
    skipDocker?: boolean;
    /** Run daemon in foreground instead of systemd (for local Docker provider) */
    foregroundMode?: boolean;
    /** Skip Tailscale installation */
    skipTailscale?: boolean;
}
/**
 * Build the cloud-init user data script from base agent args.
 *
 * Resolves all Pulumi secrets/outputs, assembles a CloudInitConfig,
 * generates + interpolates the script, and optionally compresses it.
 */
export declare function buildCloudInitUserData(name: string, args: BaseOpenClawAgentArgs, gatewayTokenValue: pulumi.Output<string>, defaults?: CloudInitDefaults): pulumi.Output<string>;
//# sourceMappingURL=shared.d.ts.map