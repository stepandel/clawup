/**
 * Provisioner config builder — generates a typed JSON config blob
 * that the static bash provisioner template reads via jq.
 *
 * All conditional logic (OAuth detection, provider aliasing, plugin config,
 * etc.) lives here in TypeScript. The bash template is purely mechanical.
 */

import * as zlib from "zlib";
import {
  CODING_AGENT_REGISTRY,
  MODEL_PROVIDERS,
  getProviderForModel,
  getProviderEnvVar,
  type CodingAgentEntry,
} from "@clawup/core";
import type { CloudInitConfig, PluginInstallConfig } from "./cloud-init";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigSetCommand {
  /** "config_set" (default) or "models_set" for `openclaw models set` */
  type?: "config_set" | "models_set";
  /** Dot-notation config path (e.g., "gateway.auth") */
  key: string;
  /** Value to set — serialized as JSON for `openclaw config set` */
  value: unknown;
  /** Optional human-readable comment for logging */
  comment?: string;
}

export interface ProvisionerConfig {
  // System setup
  skipDocker: boolean;
  createUbuntuUser: boolean;
  skipDockerGroup: boolean;

  // Tailscale
  tailscale: {
    skip: boolean;
    authKey: string;
    hostname: string;
    enableFunnel: boolean;
  };

  // Versions
  nodeVersion: number;
  nvmVersion: string;
  openclawVersion: string;
  gatewayPort: number;

  // Onboard
  onboard: {
    /** Full `openclaw onboard ...` command string */
    command: string;
  };

  // Env vars written to /home/ubuntu/.profile
  profileEnvVars: Record<string, string>;
  gitIdentity: { name: string; email: string } | null;

  // Coding agent (base64-encoded install + configure scripts)
  codingAgent: {
    installScript: string;
    configureScript: string;
  };

  // All openclaw config set / models set commands
  configSetCommands: ConfigSetCommand[];

  // Plugins
  installablePlugins: string[];
  clawhubSkills: string[];

  // Workspace files (gzip+base64 encoded content)
  workspaceFiles: Array<{ path: string; gzipBase64: string }>;

  // Deps (base64-encoded bash scripts)
  depsRoot: Array<{ name: string; script: string }>;
  depsPostInstall: Array<{ name: string; script: string }>;

  // Hooks (base64-encoded bash scripts)
  postProvisionHooks: Array<{ name: string; script: string }>;
  preStartHooks: Array<{ name: string; script: string }>;

  // Daemon / gateway
  foregroundMode: boolean;
  gatewayToken: string;
  postSetupCommands: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shell-escape a string with single quotes */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Base64-encode a UTF-8 string */
function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

// ---------------------------------------------------------------------------
// Plugin config command generation
// ---------------------------------------------------------------------------

function buildPluginConfigCommands(
  plugin: PluginInstallConfig,
  allSecrets: Record<string, string>,
): ConfigSetCommand[] {
  const cmds: ConfigSetCommand[] = [];
  const pluginConfig = plugin.config ?? {};
  const secretEnvVars = plugin.secretEnvVars ?? {};
  const internalKeys = new Set(plugin.internalKeys ?? []);
  const configPath = plugin.configPath ?? "plugins.entries";
  const transforms = plugin.configTransforms ?? [];
  const transformSourceKeys = new Set(transforms.map((t) => t.sourceKey));

  if (configPath === "channels") {
    // Channel-type plugin (e.g., Slack)
    // Secret values
    for (const [configKey, envVar] of Object.entries(secretEnvVars)) {
      if (internalKeys.has(configKey)) continue;
      cmds.push({
        key: `channels.${plugin.name}.${configKey}`,
        value: allSecrets[envVar] ?? "",
        comment: `${plugin.name} channel secret: ${configKey}`,
      });
    }

    // Non-secret config with transform support
    for (const [key, value] of Object.entries(pluginConfig)) {
      if (internalKeys.has(key)) continue;

      if (
        transformSourceKeys.has(key) &&
        typeof value === "object" &&
        value !== null
      ) {
        const transform = transforms.find((t) => t.sourceKey === key)!;
        const nested = value as Record<string, unknown>;
        for (const [nestedKey, targetKey] of Object.entries(
          transform.targetKeys,
        )) {
          if (nested[nestedKey] !== undefined) {
            cmds.push({
              key: `channels.${plugin.name}.${targetKey}`,
              value: nested[nestedKey],
            });
          }
        }
        if (transform.removeSource) continue;
      }

      cmds.push({
        key: `channels.${plugin.name}.${key}`,
        value,
      });
    }

    // Enable channel and plugin entry
    cmds.push({ key: `channels.${plugin.name}.enabled`, value: true });
    cmds.push({
      key: `plugins.entries.${plugin.name}.enabled`,
      value: true,
    });
  } else {
    // plugins.entries plugin (e.g., openclaw-linear)
    cmds.push({
      key: `plugins.entries.${plugin.name}.enabled`,
      value: true,
      comment: `Configure ${plugin.name} plugin`,
    });

    // Secret values
    for (const [configKey, envVar] of Object.entries(secretEnvVars)) {
      if (internalKeys.has(configKey)) continue;
      cmds.push({
        key: `plugins.entries.${plugin.name}.config.${configKey}`,
        value: allSecrets[envVar] ?? "",
      });
    }

    // Non-secret config
    for (const [key, value] of Object.entries(pluginConfig)) {
      if (internalKeys.has(key)) continue;
      cmds.push({
        key: `plugins.entries.${plugin.name}.config.${key}`,
        value,
      });
    }
  }

  return cmds;
}

// ---------------------------------------------------------------------------
// Config set command generation (ports logic from generateConfigPatchBash)
// ---------------------------------------------------------------------------

function buildConfigSetCommands(config: CloudInitConfig): ConfigSetCommand[] {
  const cmds: ConfigSetCommand[] = [];
  const allSecrets = config.depSecrets ?? {};
  const model = config.model ?? "anthropic/claude-opus-4-6";
  const backupModel = config.backupModel;
  const primaryProviderKey = getProviderForModel(model);
  const codingAgentName = config.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];
  const trustedProxies = config.trustedProxies ?? ["127.0.0.1"];

  // 1. Gateway auth
  cmds.push({
    key: "gateway.auth",
    value: { mode: "token", token: config.gatewayToken },
    comment: "Gateway auth token",
  });

  // 2. Trusted proxies
  cmds.push({
    key: "gateway.trustedProxies",
    value: trustedProxies,
    comment: "Trusted proxies",
  });

  // 3. Control UI
  cmds.push({
    key: "gateway.controlUi",
    value: { enabled: true, allowInsecureAuth: true },
    comment: "Control UI",
  });

  // 4. Provider env vars (in OpenClaw config)
  for (const [providerKey, apiKeyValue] of Object.entries(
    config.providerApiKeys,
  )) {
    if (providerKey === "anthropic") {
      if (apiKeyValue.startsWith("sk-ant-oat")) {
        cmds.push({
          key: "env.CLAUDE_CODE_OAUTH_TOKEN",
          value: apiKeyValue,
          comment: "Anthropic OAuth token (subscription)",
        });
      } else {
        cmds.push({
          key: "env.ANTHROPIC_API_KEY",
          value: apiKeyValue,
          comment: "Anthropic API key",
        });
      }
    } else {
      const envVar = getProviderEnvVar(providerKey);
      const providerDef = MODEL_PROVIDERS[providerKey];
      cmds.push({
        key: `env.${envVar}`,
        value: apiKeyValue,
        comment: `${providerDef?.name ?? providerKey} provider API key`,
      });
    }
  }

  // 5. Backup provider env (if different from primary)
  const backupProviderKey = backupModel
    ? getProviderForModel(backupModel)
    : undefined;
  if (backupProviderKey && backupProviderKey !== primaryProviderKey) {
    const backupProviderDef = MODEL_PROVIDERS[backupProviderKey];
    const backupApiKey = config.providerApiKeys[backupProviderKey];
    if (backupProviderDef && backupApiKey) {
      if (
        backupProviderKey === "anthropic" &&
        backupApiKey.startsWith("sk-ant-oat")
      ) {
        cmds.push({
          key: "env.CLAUDE_CODE_OAUTH_TOKEN",
          value: backupApiKey,
          comment: `Backup: Anthropic OAuth token`,
        });
      } else {
        cmds.push({
          key: `env.${backupProviderDef.envVar}`,
          value: backupApiKey,
          comment: `Backup model provider: ${backupProviderDef.name}`,
        });
      }
    }
  }

  // 6. Codex + OpenRouter aliasing
  if (codingAgentName === "codex" && primaryProviderKey === "openrouter") {
    const orKey = config.providerApiKeys["openrouter"] ?? "";
    cmds.push({
      key: "env.OPENAI_API_KEY",
      value: orKey,
      comment: "Aliased OPENROUTER_API_KEY -> OPENAI_API_KEY for Codex",
    });
    cmds.push({
      key: "env.OPENAI_BASE_URL",
      value: "https://openrouter.ai/api/v1",
      comment: "OpenRouter base URL for Codex",
    });
  }

  // 7. Heartbeat
  cmds.push({
    key: "agents.defaults.heartbeat",
    value: { every: "1m", session: "main" },
    comment: "Heartbeat config",
  });

  // 8. Model
  if (backupModel) {
    cmds.push({
      key: "agents.defaults.model",
      value: { primary: model, fallbacks: [backupModel] },
      comment: `Model: ${model} (fallback: ${backupModel})`,
    });
  } else {
    cmds.push({
      type: "models_set",
      key: "",
      value: model,
      comment: `Model: ${model}`,
    });
  }

  // 9. CLI backends
  const cliBackends = codingAgentEntry
    ? {
        "claude-cli": Object.fromEntries(
          Object.entries(codingAgentEntry.cliBackend).filter(
            ([, v]) => v !== "" && v !== "never",
          ),
        ),
      }
    : {};
  cmds.push({
    key: "agents.defaults.cliBackends",
    value: cliBackends,
    comment: `CLI backend: ${codingAgentName}`,
  });

  // 10. ACP default agent
  cmds.push({
    key: "acp.defaultAgent",
    value: "default",
    comment: "ACP default agent",
  });

  // 11. Plugin configs
  for (const plugin of config.plugins ?? []) {
    const pluginCmds = buildPluginConfigCommands(plugin, allSecrets);
    cmds.push(...pluginCmds);
  }

  // 12. Agent identity + conditional ack/allowBots
  const agentName = config.envVars?.AGENT_NAME;
  const agentEmoji = config.envVars?.AGENT_EMOJI;
  if (agentName) {
    const identity: Record<string, string> = { name: agentName };
    if (agentEmoji) identity.emoji = agentEmoji;
    cmds.push({
      key: "agents.list",
      value: [{ id: "default", identity }],
      comment: `Agent identity: ${agentName}`,
    });

    // 13. Slack allowBots
    const hasSlack = (config.plugins ?? []).some(
      (p) => p.name === "slack" && p.configPath === "channels",
    );
    if (hasSlack) {
      cmds.push({
        key: "channels.slack.allowBots",
        value: true,
        comment: "Allow bots in Slack",
      });
    }

    // 14. Ack reaction
    cmds.push({
      key: "messages.ackReaction",
      value: "eyes",
      comment: "Ack reaction emoji",
    });
  }

  // 15. Brave search
  const braveApiKey = allSecrets["BRAVE_API_KEY"];
  if (braveApiKey) {
    cmds.push({
      key: "tools.web.search",
      value: { provider: "brave", apiKey: braveApiKey },
      comment: "Brave Search API",
    });
  }

  return cmds;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildProvisionerConfig(
  config: CloudInitConfig,
): ProvisionerConfig {
  const gatewayPort = config.gatewayPort ?? 18789;
  const nodeVersion = config.nodeVersion ?? 22;
  const nvmVersion = config.nvmVersion ?? "0.40.1";
  const openclawVersion = config.openclawVersion ?? "latest";

  const codingAgentName = config.codingAgent ?? "claude-code";
  const codingAgentEntry = CODING_AGENT_REGISTRY[codingAgentName];
  const primaryProviderKey = config.modelProvider ?? "anthropic";
  const primaryApiKeyValue = config.providerApiKeys[primaryProviderKey] ?? "";

  // --- Onboard command ---
  let onboardProviderFlags: string;
  switch (primaryProviderKey) {
    case "anthropic":
      onboardProviderFlags = `--anthropic-api-key ${shellEscape(primaryApiKeyValue)}`;
      break;
    case "openai":
      onboardProviderFlags = `--openai-api-key ${shellEscape(primaryApiKeyValue)}`;
      break;
    case "google":
      onboardProviderFlags = `--auth-choice gemini-api-key --gemini-api-key ${shellEscape(primaryApiKeyValue)}`;
      break;
    case "openrouter":
      onboardProviderFlags = `--auth-choice apiKey --token-provider openrouter --token ${shellEscape(primaryApiKeyValue)}`;
      break;
    default: {
      const providerDef = MODEL_PROVIDERS[primaryProviderKey];
      onboardProviderFlags = providerDef
        ? providerDef
            .onboardFlags(providerDef.envVar)
            .replace(
              `"$${providerDef.envVar}"`,
              shellEscape(primaryApiKeyValue),
            )
        : `--anthropic-api-key ${shellEscape(primaryApiKeyValue)}`;
      break;
    }
  }

  const onboardCommand = [
    "openclaw onboard --non-interactive",
    "--mode local",
    onboardProviderFlags,
    `--gateway-port ${gatewayPort}`,
    "--gateway-bind loopback",
    "--skip-skills",
  ].join(" ");

  // --- Profile env vars ---
  const profileEnvVars: Record<string, string> = {};
  const allSecrets = config.depSecrets ?? {};

  // Provider API keys
  for (const [providerKey, value] of Object.entries(config.providerApiKeys)) {
    const envVar = getProviderEnvVar(providerKey);
    if (providerKey === "anthropic" && value.startsWith("sk-ant-oat")) {
      profileEnvVars["CLAUDE_CODE_OAUTH_TOKEN"] = value;
    } else {
      profileEnvVars[envVar] = value;
    }
  }

  // Codex + OpenRouter aliasing for .profile
  if (
    codingAgentName === "codex" &&
    Object.keys(config.providerApiKeys).includes("openrouter")
  ) {
    profileEnvVars["OPENAI_API_KEY"] =
      config.providerApiKeys["openrouter"] ?? "";
    profileEnvVars["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1";
  }

  // Plugin secret env vars
  for (const plugin of config.plugins ?? []) {
    for (const envVar of Object.values(plugin.secretEnvVars ?? {})) {
      const value = allSecrets[envVar];
      if (value) profileEnvVars[envVar] = value;
    }
  }

  // Dep secret env vars
  for (const dep of config.deps ?? []) {
    for (const secret of Object.values(dep.secrets)) {
      const value = allSecrets[secret.envVar];
      if (value) profileEnvVars[secret.envVar] = value;
    }
  }

  // Additional env vars (non-secret, e.g., AGENT_NAME, AGENT_EMOJI)
  if (config.envVars) {
    for (const [key, value] of Object.entries(config.envVars)) {
      profileEnvVars[key] = value;
    }
  }

  // --- Git identity ---
  const gitIdentity = config.envVars?.AGENT_NAME
    ? {
        name: config.envVars.AGENT_NAME,
        email: `${config.envVars.AGENT_NAME.toLowerCase().replace(/[^a-z0-9]/g, "")}@clawup.sh`,
      }
    : null;

  // --- Coding agent scripts ---
  const strippedModel = (config.model ?? "anthropic/claude-opus-4-6").replace(
    /^[^/]+\//,
    "",
  );
  const configScript = codingAgentEntry
    ? codingAgentEntry.configureModelScript.replace(
        /\$\{MODEL\}/g,
        strippedModel,
      )
    : "";

  // --- Config set commands ---
  const configSetCommands = buildConfigSetCommands(config);

  // --- Workspace files ---
  const workspaceFiles = Object.entries(config.workspaceFiles ?? {}).map(
    ([path, content]) => {
      const normalized = path.replace(/\\/g, "/");
      if (
        normalized.includes("..") ||
        normalized.startsWith("/") ||
        normalized.includes("\0")
      ) {
        throw new Error(
          `Invalid workspace file path: "${path}". Paths must be relative and cannot contain "..".`,
        );
      }
      return {
        path,
        gzipBase64: zlib
          .gzipSync(Buffer.from(content, "utf-8"))
          .toString("base64"),
      };
    },
  );

  // --- Deps ---
  const depsRoot = (config.deps ?? [])
    .filter((d) => d.installScript)
    .map((d) => ({ name: d.name, script: b64(d.installScript) }));

  const depsPostInstall = (config.deps ?? [])
    .filter((d) => d.postInstallScript)
    .map((d) => ({ name: d.name, script: b64(d.postInstallScript) }));

  // --- Hooks ---
  const postProvisionHooks = (config.plugins ?? [])
    .filter((p) => p.hooks?.postProvision)
    .map((p) => ({ name: p.name, script: b64(p.hooks!.postProvision!) }));

  const preStartHooks = (config.plugins ?? [])
    .filter((p) => p.hooks?.preStart)
    .map((p) => ({ name: p.name, script: b64(p.hooks!.preStart!) }));

  // --- Plugins ---
  const installablePlugins = (config.plugins ?? [])
    .filter((p) => p.installable !== false)
    .map((p) => p.name);

  return {
    skipDocker: config.skipDocker ?? false,
    createUbuntuUser: config.createUbuntuUser ?? false,
    skipDockerGroup: config.skipDocker ?? false,

    tailscale: {
      skip: config.skipTailscale ?? false,
      authKey: config.tailscaleAuthKey,
      hostname: config.tailscaleHostname ?? "",
      enableFunnel: config.enableFunnel ?? false,
    },

    nodeVersion,
    nvmVersion,
    openclawVersion,
    gatewayPort,

    onboard: { command: onboardCommand },

    profileEnvVars,
    gitIdentity,

    codingAgent: {
      installScript: codingAgentEntry ? b64(codingAgentEntry.installScript) : "",
      configureScript: configScript ? b64(configScript) : "",
    },

    configSetCommands,

    installablePlugins,
    clawhubSkills: config.clawhubSkills ?? [],

    workspaceFiles,
    depsRoot,
    depsPostInstall,
    postProvisionHooks,
    preStartHooks,

    foregroundMode: config.foregroundMode ?? false,
    gatewayToken: config.gatewayToken,
    postSetupCommands: config.postSetupCommands ?? [],
  };
}
