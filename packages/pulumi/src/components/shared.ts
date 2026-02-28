/**
 * Shared helpers for OpenClaw agent components (AWS, Hetzner, local Docker)
 *
 * Extracts the duplicated SSH key generation, gateway token derivation,
 * and user data assembly that is shared across providers.
 */

import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import * as crypto from "crypto";
import { interpolateCloudInit } from "./cloud-init";
import { generateNixEntrypoint, type NixEntrypointConfig } from "./nix-entrypoint";
import { generateNixCloudInit, compressNixCloudInit, type NixCloudInitConfig } from "./nix-cloud-init";
import { generateFullOpenClawConfig, type PluginEntry } from "./config-generator";
import { getProviderEnvVar } from "@clawup/core";
import type { BaseOpenClawAgentArgs } from "./types";

/**
 * Generate an SSH key pair and a gateway authentication token.
 * All providers use the same ED25519 key generation pattern.
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
 * Resolves all Pulumi secrets/outputs, performs OAuth detection, builds
 * openclaw.json, and returns resolved config values needed by all generators.
 */
function resolveSecrets(
  name: string,
  args: BaseOpenClawAgentArgs,
  gatewayTokenValue: pulumi.Output<string>,
  callback: (resolved: {
    tsAuthKey: string;
    gwToken: string;
    gatewayPort: number;
    model: string;
    tsHostname: string;
    providerEnv: Record<string, string>;
    additionalSecrets: Record<string, string>;
    openclawConfigJson: string;
    nixDeps: { name: string; postInstallScript: string; secrets: Record<string, { envVar: string }> }[];
  }) => string,
): pulumi.Output<string> {
  const pluginSecretEntries = Object.entries(args.pluginSecrets ?? {});
  const pluginSecretOutputs = pluginSecretEntries.map(([, v]) => pulumi.output(v));

  const depSecretEntries = Object.entries(args.depSecrets ?? {});
  const depSecretOutputs = depSecretEntries.map(([, v]) => pulumi.output(v));

  const providerKeyEntries = Object.entries(args.providerApiKeys);
  const providerKeyOutputs = providerKeyEntries.map(([, v]) => pulumi.output(v));

  return pulumi
    .all([
      args.tailscaleAuthKey,
      gatewayTokenValue,
      ...providerKeyOutputs,
      ...pluginSecretOutputs,
      ...depSecretOutputs,
    ])
    .apply(([tsAuthKey, gwToken, ...secretValues]) => {
      const resolvedProviderKeys: Record<string, string> = {};
      providerKeyEntries.forEach(([providerKey], idx) => {
        resolvedProviderKeys[providerKey] = secretValues[idx] as string;
      });
      const remainingSecrets = secretValues.slice(providerKeyEntries.length);

      return pulumi
        .all([
          pulumi.output(args.gatewayPort ?? 18789),
          pulumi.output(args.model ?? "anthropic/claude-opus-4-6"),
        ])
        .apply(([gatewayPort, model]) => {
          const tsHostname = `${pulumi.getStack()}-${name}`;

          // OAuth detection
          const providerEnv: Record<string, string> = {};
          for (const [providerKey, value] of Object.entries(resolvedProviderKeys)) {
            if (providerKey === "anthropic" && value.startsWith("sk-ant-oat")) {
              providerEnv["CLAUDE_CODE_OAUTH_TOKEN"] = value;
            } else {
              const envVar = getProviderEnvVar(providerKey);
              providerEnv[envVar] = value;
            }
          }

          const additionalSecrets: Record<string, string> = {};
          for (const [envVar, value] of Object.entries(providerEnv)) {
            additionalSecrets[envVar] = value;
          }

          const resolvedSecrets: Record<string, string> = {};
          pluginSecretEntries.forEach(([envVar], idx) => {
            const value = remainingSecrets[idx] as string;
            resolvedSecrets[envVar] = value;
            additionalSecrets[envVar] = value;
          });

          depSecretEntries.forEach(([envVar], idx) => {
            additionalSecrets[envVar] = remainingSecrets[pluginSecretEntries.length + idx] as string;
          });

          const pluginEntries: PluginEntry[] = (args.plugins ?? []).map((p) => ({
            name: p.name,
            enabled: true,
            config: p.config ?? {},
            secretEnvVars: p.secretEnvVars,
            configPath: p.configPath,
            internalKeys: p.internalKeys,
            configTransforms: p.configTransforms,
          }));

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

          const nixDeps = (args.deps ?? []).map((d) => ({
            name: d.name,
            postInstallScript: d.postInstallScript,
            secrets: d.secrets,
          }));

          return callback({
            tsAuthKey,
            gwToken,
            gatewayPort: gatewayPort as number,
            model: model as string,
            tsHostname,
            providerEnv,
            additionalSecrets,
            openclawConfigJson,
            nixDeps,
          });
        });
    });
}

/**
 * Build the Nix entrypoint script for the local Docker provider.
 *
 * Resolves all Pulumi secrets/outputs, performs OAuth detection,
 * generates openclaw.json, and produces a minimal entrypoint for
 * the pre-built Nix Docker image.
 */
export function buildNixEntrypoint(
  name: string,
  args: BaseOpenClawAgentArgs,
  gatewayTokenValue: pulumi.Output<string>,
): pulumi.Output<string> {
  return resolveSecrets(name, args, gatewayTokenValue, (r) => {
    const nixConfig: NixEntrypointConfig = {
      openclawConfigJson: r.openclawConfigJson,
      providerEnv: r.providerEnv,
      gatewayToken: r.gwToken,
      codingAgent: args.codingAgent,
      model: r.model,
      workspaceFiles: args.workspaceFiles,
      envVars: args.envVars,
      plugins: args.plugins,
      deps: r.nixDeps,
      clawhubSkills: args.clawhubSkills,
      postSetupCommands: args.postSetupCommands,
    };

    const script = generateNixEntrypoint(nixConfig);

    return interpolateCloudInit(script, {
      tailscaleAuthKey: r.tsAuthKey,
      gatewayToken: r.gwToken,
      additionalSecrets: r.additionalSecrets,
    });
  });
}

/**
 * Build the NixOS cloud-init user data for cloud providers (AWS/Hetzner).
 *
 * Resolves all Pulumi secrets/outputs, performs OAuth detection,
 * generates openclaw.json, and produces a minimal cloud-init for
 * pre-built NixOS VM images. Includes Tailscale and systemd management.
 */
export function buildNixCloudInitUserData(
  name: string,
  args: BaseOpenClawAgentArgs,
  gatewayTokenValue: pulumi.Output<string>,
  defaults?: { compress?: boolean },
): pulumi.Output<string> {
  return resolveSecrets(name, args, gatewayTokenValue, (r) => {
    const nixConfig: NixCloudInitConfig = {
      openclawConfigJson: r.openclawConfigJson,
      providerEnv: r.providerEnv,
      gatewayToken: r.gwToken,
      gatewayPort: r.gatewayPort,
      codingAgent: args.codingAgent,
      model: r.model,
      tailscaleAuthKey: r.tsAuthKey,
      tailscaleHostname: r.tsHostname,
      workspaceFiles: args.workspaceFiles,
      envVars: args.envVars,
      plugins: args.plugins,
      deps: r.nixDeps,
      clawhubSkills: args.clawhubSkills,
      postSetupCommands: args.postSetupCommands,
      enableFunnel: args.enableFunnel,
    };

    const script = generateNixCloudInit(nixConfig);

    const interpolated = interpolateCloudInit(script, {
      tailscaleAuthKey: r.tsAuthKey,
      gatewayToken: r.gwToken,
      additionalSecrets: r.additionalSecrets,
    });

    return defaults?.compress ? compressNixCloudInit(interpolated) : interpolated;
  });
}
