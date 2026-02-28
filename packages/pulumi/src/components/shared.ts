/**
 * Shared helpers for OpenClaw agent components (AWS + Hetzner)
 *
 * Extracts the duplicated SSH key generation, gateway token derivation,
 * and cloud-init user data assembly that was identical across providers.
 */

import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import * as crypto from "crypto";
import { generateCloudInit, compressCloudInit, CloudInitConfig } from "./cloud-init";
import { getProviderForModel, getProviderEnvVar } from "@clawup/core";
import type { BaseOpenClawAgentArgs } from "./types";

/**
 * Generate an SSH key pair and a gateway authentication token.
 * Both providers use the same ED25519 key generation pattern.
 */
export function generateKeyPairAndToken(
  name: string,
  resourceOptions: pulumi.ResourceOptions
): {
  sshKey: tls.PrivateKey;
  gatewayTokenValue: pulumi.Output<string>;
} {
  const sshKey = new tls.PrivateKey(
    `${name}-ssh-key`,
    { algorithm: "ED25519" },
    resourceOptions
  );

  const tokenKey = new tls.PrivateKey(
    `${name}-gateway-token-key`,
    { algorithm: "ED25519" },
    resourceOptions
  );

  const gatewayTokenValue = tokenKey.publicKeyOpenssh.apply((key) => {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    return hash.substring(0, 48);
  });

  return { sshKey, gatewayTokenValue };
}

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
export function buildCloudInitUserData(
  name: string,
  args: BaseOpenClawAgentArgs,
  gatewayTokenValue: pulumi.Output<string>,
  defaults?: CloudInitDefaults,
): pulumi.Output<string> {
  const pluginSecretEntries = Object.entries(args.pluginSecrets ?? {});
  const pluginSecretOutputs = pluginSecretEntries.map(([, v]) => pulumi.output(v));

  const depSecretEntries = Object.entries(args.depSecrets ?? {});
  const depSecretOutputs = depSecretEntries.map(([, v]) => pulumi.output(v));

  // Resolve provider API keys
  const providerKeyEntries = Object.entries(args.providerApiKeys);
  const providerKeyOutputs = providerKeyEntries.map(([, v]) => pulumi.output(v));

  // Stage 1: resolve all string secrets (same type, safe in one pulumi.all)
  return pulumi
    .all([
      args.tailscaleAuthKey,
      gatewayTokenValue,
      ...providerKeyOutputs,
      ...pluginSecretOutputs,
      ...depSecretOutputs,
    ])
    .apply(([tsAuthKey, gwToken, ...secretValues]) => {
      // Split resolved secret values back into their groups
      const resolvedProviderKeys: Record<string, string> = {};
      providerKeyEntries.forEach(([providerKey], idx) => {
        resolvedProviderKeys[providerKey] = secretValues[idx] as string;
      });
      const remainingSecrets = secretValues.slice(providerKeyEntries.length);

      // Stage 2: resolve mixed-type Input<> config values
      return pulumi
        .all([
          pulumi.output(defaults?.gatewayPort ?? args.gatewayPort ?? 18789),
          pulumi.output(defaults?.browserPort ?? args.browserPort ?? 18791),
          pulumi.output(defaults?.model ?? args.model ?? "anthropic/claude-opus-4-6"),
          pulumi.output(defaults?.enableSandbox ?? args.enableSandbox ?? true),
        ])
        .apply(([gatewayPort, browserPort, model, enableSandbox]) => {
          const tsHostname = `${pulumi.getStack()}-${name}`;

          // Build additional secrets map from plugin secrets + dep secrets + provider API keys
          const additionalSecrets: Record<string, string> = {};

          // Add all provider API keys as env var placeholders for interpolation
          for (const [providerKey, value] of Object.entries(resolvedProviderKeys)) {
            const envVar = getProviderEnvVar(providerKey);
            additionalSecrets[envVar] = value;
          }

          pluginSecretEntries.forEach(([envVar], idx) => {
            additionalSecrets[envVar] = remainingSecrets[idx] as string;
          });
          depSecretEntries.forEach(([envVar], idx) => {
            additionalSecrets[envVar] = remainingSecrets[pluginSecretEntries.length + idx] as string;
          });

          const cloudInitConfig: CloudInitConfig = {
            providerApiKeys: resolvedProviderKeys,
            tailscaleAuthKey: tsAuthKey,
            gatewayToken: gwToken,
            gatewayPort: gatewayPort as number,
            browserPort: browserPort as number,
            model: model as string,
            modelProvider: getProviderForModel(model as string),
            backupModel: args.backupModel as string | undefined,
            codingAgent: args.codingAgent,
            enableSandbox: enableSandbox as boolean,
            tailscaleHostname: tsHostname,
            workspaceFiles: args.workspaceFiles,
            envVars: args.envVars,
            postSetupCommands: args.postSetupCommands,
            createUbuntuUser: defaults?.createUbuntuUser,
            skipTailscale: defaults?.skipTailscale,
            skipDocker: defaults?.skipDocker,
            foregroundMode: defaults?.foregroundMode,
            plugins: args.plugins,
            enableFunnel: args.enableFunnel,
            clawhubSkills: args.clawhubSkills,
            deps: args.deps,
            depSecrets: additionalSecrets,
          };

          // Secrets are now embedded directly in the provisioner JSON config.
          // No interpolation pass needed — generateCloudInit bakes them in.
          const script = generateCloudInit(cloudInitConfig);
          return defaults?.compress ? compressCloudInit(script) : script;
        });
    });
}
