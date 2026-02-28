/**
 * Shared helpers for OpenClaw agent components (AWS + Hetzner)
 *
 * Extracts the duplicated SSH key generation, gateway token derivation,
 * and cloud-init user data assembly that was identical across providers.
 */

import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import * as crypto from "crypto";
import { generateCloudInit, interpolateCloudInit, compressCloudInit, CloudInitConfig } from "./cloud-init";
import { generateFullOpenClawConfig, type PluginEntry } from "./config-generator";
import { getProviderEnvVar } from "@clawup/core";
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
  model?: string;
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
 * Resolves all Pulumi secrets/outputs, performs OAuth detection,
 * generates the complete openclaw.json, assembles the cloud-init script,
 * interpolates secrets, and optionally compresses it.
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
          pulumi.output(defaults?.model ?? args.model ?? "anthropic/claude-opus-4-6"),
        ])
        .apply(([gatewayPort, model]) => {
          const tsHostname = `${pulumi.getStack()}-${name}`;

          // OAuth detection: determine correct env var for each provider key
          const providerEnv: Record<string, string> = {};
          for (const [providerKey, value] of Object.entries(resolvedProviderKeys)) {
            if (providerKey === "anthropic" && value.startsWith("sk-ant-oat")) {
              // OAuth token from Claude Pro/Max subscription
              providerEnv["CLAUDE_CODE_OAUTH_TOKEN"] = value;
            } else {
              const envVar = getProviderEnvVar(providerKey);
              providerEnv[envVar] = value;
            }
          }

          // Build additional secrets map for interpolateCloudInit
          const additionalSecrets: Record<string, string> = {};
          for (const [envVar, value] of Object.entries(providerEnv)) {
            additionalSecrets[envVar] = value;
          }

          // Resolve plugin secrets
          const resolvedSecrets: Record<string, string> = {};
          pluginSecretEntries.forEach(([envVar], idx) => {
            const value = remainingSecrets[idx] as string;
            resolvedSecrets[envVar] = value;
            additionalSecrets[envVar] = value;
          });

          // Resolve dep secrets
          depSecretEntries.forEach(([envVar], idx) => {
            additionalSecrets[envVar] = remainingSecrets[pluginSecretEntries.length + idx] as string;
          });

          // Build plugin entries for config generator
          const pluginEntries: PluginEntry[] = (args.plugins ?? []).map((p) => ({
            name: p.name,
            enabled: true,
            config: p.config ?? {},
            secretEnvVars: p.secretEnvVars,
            configPath: p.configPath,
            internalKeys: p.internalKeys,
            configTransforms: p.configTransforms,
          }));

          // Generate complete openclaw.json
          const openclawConfig = generateFullOpenClawConfig({
            gatewayPort: gatewayPort as number,
            gatewayToken: gwToken,
            model: model as string,
            backupModel: args.backupModel as string | undefined,
            codingAgent: args.codingAgent,
            plugins: pluginEntries,
            braveApiKey: additionalSecrets["BRAVE_API_KEY"],
            agentName: args.envVars?.AGENT_NAME,
            agentEmoji: args.envVars?.AGENT_EMOJI,
            providerEnv,
            resolvedSecrets,
          });
          const openclawConfigJson = JSON.stringify(openclawConfig, null, 2);

          const cloudInitConfig: CloudInitConfig = {
            openclawConfigJson,
            providerEnv,
            providerApiKeys: resolvedProviderKeys,
            tailscaleAuthKey: tsAuthKey,
            gatewayToken: gwToken,
            gatewayPort: gatewayPort as number,
            model: model as string,
            codingAgent: args.codingAgent,
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
          };

          const script = generateCloudInit(cloudInitConfig);
          const interpolated = interpolateCloudInit(script, {
            tailscaleAuthKey: tsAuthKey,
            gatewayToken: gwToken,
            additionalSecrets,
          });

          return defaults?.compress ? compressCloudInit(interpolated) : interpolated;
        });
    });
}
