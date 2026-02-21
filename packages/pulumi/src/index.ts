/**
 * Agent Army - Data-Driven Multi-Agent Pulumi Stack
 *
 * Reads agent-army.yaml manifest to dynamically deploy OpenClaw agents.
 * The manifest is created by `agent-army init` and serves as the single
 * source of truth for the agent fleet configuration.
 *
 * All agents share a single VPC for cost optimization.
 * Each agent loads workspace files from identity repos.
 * Secrets are pulled from Pulumi config (set by CLI or ESC).
 * Plugin configs are loaded from ~/.agent-army/configs/<stack>/plugins/.
 */

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";
import { OpenClawAgent, HetznerOpenClawAgent, PluginInstallConfig } from "./components";
import type { BaseOpenClawAgentArgs, DepInstallConfig } from "./components";
import { SharedVpc } from "./shared-vpc";
import {
  classifySkills,
  PLUGIN_REGISTRY,
  resolveDeps,
  collectDepSecrets,
} from "@agent-army/core";
import { fetchIdentitySync } from "@agent-army/core/identity";
import type { AgentDefinition, ArmyManifest, PluginConfigFile } from "@agent-army/core";
import * as os from "os";

// -----------------------------------------------------------------------------
// Configuration from Pulumi Config / ESC
// -----------------------------------------------------------------------------

const config = new pulumi.Config();

const anthropicApiKey = config.requireSecret("anthropicApiKey");
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");
const tailnetDnsName = config.require("tailnetDnsName");
const instanceType = config.get("instanceType") ?? "t3.medium";
const ownerName = config.get("ownerName") ?? "Boss";
const timezone = config.get("timezone") ?? "PST (America/Los_Angeles)";
const workingHours = config.get("workingHours") ?? "9am-6pm";
const userNotes = config.get("userNotes") ?? "No additional notes provided yet.";

// Identity cache directory
const identityCacheDir = path.join(os.homedir(), ".agent-army", "identity-cache");


/**
 * Process template placeholders in workspace files
 */
function processTemplates(
  files: Record<string, string>,
  variables: Record<string, string>
): Record<string, string> {
  const processed: Record<string, string> = {};

  for (const [filename, content] of Object.entries(files)) {
    let processedContent = content;
    for (const [key, value] of Object.entries(variables)) {
      processedContent = processedContent.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, "g"),
        value
      );
    }
    processed[filename] = processedContent;
  }

  return processed;
}

// -----------------------------------------------------------------------------
// Load Manifest (YAML)
// -----------------------------------------------------------------------------

// Pulumi sets cwd to the project root (where Pulumi.yaml lives)
const manifestPath = path.join(process.cwd(), "agent-army.yaml");
if (!fs.existsSync(manifestPath)) {
  throw new Error(
    "agent-army.yaml not found. Run `agent-army init` to create it."
  );
}

// Cast as partial — old manifests may omit `provider` (defaults to "aws" below)
const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf-8")) as ArmyManifest & { provider?: string };

// Load plugin configs from ~/.agent-army/configs/<stackName>/plugins/
const pluginConfigsDir = path.join(os.homedir(), ".agent-army", "configs", manifest.stackName, "plugins");
const pluginConfigs: Record<string, PluginConfigFile> = {};
if (fs.existsSync(pluginConfigsDir)) {
  for (const file of fs.readdirSync(pluginConfigsDir)) {
    if (file.endsWith(".yaml")) {
      const pluginName = file.replace(/\.yaml$/, "");
      try {
        const raw = fs.readFileSync(path.join(pluginConfigsDir, file), "utf-8");
        pluginConfigs[pluginName] = YAML.parse(raw) as PluginConfigFile;
      } catch (err) {
        pulumi.log.warn(`Failed to load plugin config '${pluginName}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// Default provider to AWS for backwards compatibility with existing manifests
const provider = manifest.provider ?? "aws";

// Validate provider
if (provider !== "aws" && provider !== "hetzner") {
  throw new Error(`Unsupported provider: ${provider}. Supported providers are: aws, hetzner`);
}

// -----------------------------------------------------------------------------
// Resource Tags (AWS) / Labels (Hetzner)
// -----------------------------------------------------------------------------

const baseTags = {
  Project: "agent-army",
  Environment: pulumi.getStack(),
  ManagedBy: "pulumi",
};

// -----------------------------------------------------------------------------
// Provider-specific infrastructure
// -----------------------------------------------------------------------------

let sharedVpc: SharedVpc | undefined;

if (provider === "aws") {
  // -------------------------------------------------------------------------
  // Dynamic AZ Selection - Find an AZ that supports all instance types
  // -------------------------------------------------------------------------

  // Collect all instance types we'll need
  const instanceTypes = [
    instanceType, // default from config
    ...manifest.agents.map(a => a.instanceType).filter(Boolean) as string[]
  ];
  const uniqueInstanceTypes = [...new Set(instanceTypes)];

  // Query AWS to find which AZs support our instance types
  const availabilityZone = pulumi
    .all(
      uniqueInstanceTypes.map((instanceType) =>
        aws.ec2.getInstanceTypeOfferings({
          filters: [
            {
              name: "instance-type",
              values: [instanceType],
            },
          ],
          locationType: "availability-zone",
        })
      )
    )
    .apply((offeringsResults) => {
      // Build a set of AZs for each instance type
      const azSets = offeringsResults.map((result) =>
        new Set(result.locations)
      );

      // Find intersection - AZs that support ALL instance types
      const intersection = azSets[0];
      for (let i = 1; i < azSets.length; i++) {
        for (const az of intersection) {
          if (!azSets[i].has(az)) {
            intersection.delete(az);
          }
        }
      }

      // Pick the first available AZ alphabetically for consistency
      const availableAzs = Array.from(intersection).sort();

      if (availableAzs.length === 0) {
        throw new Error(
          `No availability zone found that supports all instance types: ${uniqueInstanceTypes.join(", ")}`
        );
      }

      return availableAzs[0];
    });

  // -------------------------------------------------------------------------
  // Shared VPC (cost optimization - all agents share one VPC)
  // -------------------------------------------------------------------------

  sharedVpc = new SharedVpc("agent-army", {
    availabilityZone: availabilityZone,
    tags: baseTags,
  });

  // VPC outputs
  module.exports["vpcId"] = sharedVpc.vpcId;
  module.exports["subnetId"] = sharedVpc.subnetId;
  module.exports["securityGroupId"] = sharedVpc.securityGroupId;
  module.exports["selectedAvailabilityZone"] = availabilityZone;
}

// Hetzner reads hcloud:token automatically from Pulumi config — no explicit provider needed

// -----------------------------------------------------------------------------
// Helper: Build PluginInstallConfig[] for an agent
// -----------------------------------------------------------------------------

function buildPluginsForAgent(
  agent: AgentDefinition,
  identityDefaults?: Record<string, Record<string, unknown>>,
  identityPlugins?: string[]
): { plugins: PluginInstallConfig[]; pluginSecrets: Record<string, pulumi.Output<string>>; enableFunnel: boolean } {
  const plugins: PluginInstallConfig[] = [];
  const pluginSecrets: Record<string, pulumi.Output<string>> = {};
  let enableFunnel = false;

  const pluginList = identityPlugins ?? [];

  for (const pluginName of pluginList) {
    let agentSection: Record<string, unknown>;

    if (agent.plugins && agent.plugins[pluginName]) {
      // New format: inline plugin config on the agent definition
      agentSection = agent.plugins[pluginName];
    } else {
      // Backward compat: fall back to file-based plugin config
      const pluginCfg = pluginConfigs[pluginName];
      const userConfig = pluginCfg?.agents?.[agent.role] ?? {};
      const identityConfig = identityDefaults?.[pluginName] ?? {};
      agentSection = { ...identityConfig, ...userConfig };
    }

    const registryEntry = PLUGIN_REGISTRY[pluginName];
    const secretMapping = registryEntry?.secretEnvVars ?? {};

    plugins.push({
      name: pluginName,
      config: agentSection,
      secretEnvVars: Object.keys(secretMapping).length > 0 ? secretMapping : undefined,
      installable: registryEntry?.installable ?? true,
    });

    // Collect secret outputs from Pulumi config
    for (const [, envVar] of Object.entries(secretMapping)) {
      if (!pluginSecrets[envVar]) {
        // Derive Pulumi config key from role + env var pattern
        // e.g., LINEAR_API_KEY → <role>LinearApiKey, SLACK_BOT_TOKEN → <role>SlackBotToken
        const secret = config.getSecret(`${agent.role}${envVarToConfigKey(envVar)}`);
        if (secret) {
          pluginSecrets[envVar] = secret;
        }
      }
    }

    // Enable funnel if the plugin needs webhooks
    if (registryEntry?.needsFunnel) {
      enableFunnel = true;
    }
  }

  return { plugins, pluginSecrets, enableFunnel };
}

/**
 * Convert an env var name to a Pulumi config key suffix.
 * e.g., LINEAR_API_KEY → LinearApiKey, LINEAR_WEBHOOK_SECRET → LinearWebhookSecret
 */
function envVarToConfigKey(envVar: string): string {
  // Strip the common prefix (e.g., "LINEAR_") and convert to camelCase
  // LINEAR_API_KEY → LinearApiKey
  return envVar
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// -----------------------------------------------------------------------------
// Dynamic Agent Deployments
// -----------------------------------------------------------------------------

const agentOutputs: Record<string, {
  tailscaleUrl: pulumi.Output<string>;
  gatewayToken: pulumi.Output<string>;
  instanceId: pulumi.Output<string>;
  publicIp: pulumi.Output<string>;
  sshPrivateKey: pulumi.Output<string>;
}> = {};

/**
 * Build the base agent args shared by all providers.
 * Provider-specific fields (VPC, location, tags/labels) are added by the caller.
 */
function buildBaseAgentArgs(agent: AgentDefinition): {
  baseArgs: BaseOpenClawAgentArgs;
  agentDisplayName: string;
  agentVolumeSize: number;
} {
  const templateVars: Record<string, string> = {
    OWNER_NAME: ownerName,
    TIMEZONE: timezone,
    WORKING_HOURS: workingHours,
    USER_NOTES: userNotes,
    ...(manifest.templateVars ?? {}),
  };

  // Fetch identity (always required)
  const identity = fetchIdentitySync(agent.identity, identityCacheDir);

  // Identity files are the workspace files
  const workspaceFiles = processTemplates(identity.files, templateVars);

  // Pull defaults from identity manifest
  const agentEmoji = identity.manifest.emoji ?? "";
  const agentDisplayName = agent.displayName || identity.manifest.displayName;
  const agentVolumeSize = agent.volumeSize ?? identity.manifest.volumeSize ?? 30;

  // Extract public (clawhub) skills from identity manifest
  const { public: publicSkills } = classifySkills(identity.manifest.skills);
  const clawhubSkillSlugs = publicSkills.map((s) => s.slug);

  // Build plugin configs for this agent (always from identity)
  const { plugins, pluginSecrets, enableFunnel } = buildPluginsForAgent(agent, identity.manifest.pluginDefaults, identity.manifest.plugins);

  // Resolve model/codingAgent from identity
  const agentModel = identity.manifest.model ?? "anthropic/claude-opus-4-6";
  const agentBackupModel = identity.manifest.backupModel;
  const agentCodingAgent = identity.manifest.codingAgent ?? "claude-code";

  // Resolve deps from identity
  const depNames = identity.manifest.deps ?? [];
  const resolvedDeps = resolveDeps(depNames);
  const depEntries: DepInstallConfig[] = resolvedDeps.map(d => ({
    name: d.name,
    installScript: d.entry.installScript,
    postInstallScript: d.entry.postInstallScript,
    secrets: Object.fromEntries(
      Object.entries(d.entry.secrets).map(([k, v]) => [k, { envVar: v.envVar }])
    ),
  }));

  // Collect dep secrets from Pulumi config (scope-aware)
  const depSecretDefs = collectDepSecrets(resolvedDeps);
  const depSecrets: Record<string, pulumi.Output<string>> = {};
  for (const def of depSecretDefs) {
    const secret = def.scope === "agent"
      ? config.getSecret(`${agent.role}${def.configKeySuffix}`)
      : config.getSecret(`${def.configKeySuffix.charAt(0).toLowerCase()}${def.configKeySuffix.slice(1)}`);
    if (secret) {
      depSecrets[def.envVar] = secret;
    }
  }

  return {
    baseArgs: {
      anthropicApiKey,
      tailscaleAuthKey,
      tailnetDnsName,
      model: agentModel,
      backupModel: agentBackupModel,
      codingAgent: agentCodingAgent,
      workspaceFiles,
      envVars: {
        AGENT_ROLE: agent.role,
        AGENT_NAME: agentDisplayName,
        AGENT_EMOJI: agentEmoji,
        ...agent.envVars,
      },
      plugins,
      pluginSecrets,
      enableFunnel,
      clawhubSkills: clawhubSkillSlugs,
      deps: depEntries,
      depSecrets,
    },
    agentDisplayName,
    agentVolumeSize,
  };
}

for (const agent of manifest.agents) {
  const { baseArgs, agentVolumeSize } = buildBaseAgentArgs(agent);

  if (provider === "aws") {
    const agentResource = new OpenClawAgent(agent.name, {
      ...baseArgs,
      instanceType: agent.instanceType ?? instanceType,
      volumeSize: agentVolumeSize ?? 30,
      vpcId: sharedVpc!.vpcId,
      subnetId: sharedVpc!.subnetId,
      securityGroupId: sharedVpc!.securityGroupId,
      tags: {
        ...baseTags,
        AgentRole: agent.role,
        AgentName: agent.displayName,
      },
    });

    agentOutputs[agent.role] = {
      tailscaleUrl: agentResource.tailscaleUrl,
      gatewayToken: agentResource.gatewayToken,
      instanceId: agentResource.instanceId,
      publicIp: agentResource.publicIp,
      sshPrivateKey: agentResource.sshPrivateKey,
    };
  } else {
    const agentResource = new HetznerOpenClawAgent(agent.name, {
      ...baseArgs,
      serverType: agent.instanceType ?? instanceType,
      location: manifest.region,
      labels: {
        ...baseTags,
        AgentRole: agent.role,
        AgentName: agent.displayName,
      },
    });

    agentOutputs[agent.role] = {
      tailscaleUrl: agentResource.tailscaleUrl,
      gatewayToken: agentResource.gatewayToken,
      instanceId: agentResource.serverId,
      publicIp: agentResource.publicIp,
      sshPrivateKey: agentResource.sshPrivateKey,
    };
  }
}

// -----------------------------------------------------------------------------
// Dynamic Stack Outputs
// -----------------------------------------------------------------------------

for (const [role, outputs] of Object.entries(agentOutputs)) {
  module.exports[`${role}TailscaleUrl`] = pulumi.secret(outputs.tailscaleUrl);
  module.exports[`${role}GatewayToken`] = pulumi.secret(outputs.gatewayToken);
  module.exports[`${role}InstanceId`] = outputs.instanceId;
  module.exports[`${role}PublicIp`] = outputs.publicIp;
  module.exports[`${role}SshPrivateKey`] = pulumi.secret(outputs.sshPrivateKey);

  // Webhook URL for plugins that need it (derived from Tailscale Funnel public URL)
  module.exports[`${role}WebhookUrl`] = outputs.tailscaleUrl.apply((url) => {
    // Extract base URL (remove query params like ?token=...) and append webhook path
    const baseUrl = url.split("?")[0].replace(/\/$/, "");
    return `${baseUrl}/hooks/linear`;
  });
}
