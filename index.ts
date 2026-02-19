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
import { OpenClawAgent, HetznerOpenClawAgent, PluginInstallConfig } from "./src";
import { SharedVpc } from "./shared-vpc";
import { fetchIdentitySync } from "./cli/lib/identity";
import { PRESET_TO_IDENTITY } from "./cli/lib/constants";
import { classifySkills } from "./cli/lib/skills";
import { PLUGIN_REGISTRY } from "./cli/lib/plugin-registry";
import { resolveDeps, collectDepSecrets } from "./cli/lib/deps";
import * as os from "os";

// -----------------------------------------------------------------------------
// Manifest type (duplicated here to avoid importing from cli/)
// -----------------------------------------------------------------------------

interface ManifestAgent {
  name: string;
  displayName: string;
  role: string;
  preset: string | null;
  /** Git URL or local path to an identity repo/folder. Mutually exclusive with `preset`. */
  identity?: string;
  /** Pin the identity to a specific Git tag or commit hash */
  identityVersion?: string;
  volumeSize: number;
  instanceType?: string;
  /** @deprecated Use an identity repo with a SOUL.md file instead. */
  soulContent?: string;
  /** @deprecated Use an identity repo with an IDENTITY.md file instead. */
  identityContent?: string;
  envVars?: Record<string, string>;
  /** Plugin names to install on this agent */
  plugins?: string[];
  /** Dep names for this agent (e.g., ["gh", "brave-search"]) */
  deps?: string[];
}

interface Manifest {
  stackName: string;
  provider?: "aws" | "hetzner";
  region: string;
  instanceType: string;
  ownerName: string;
  timezone?: string;
  workingHours?: string;
  userNotes?: string;
  linearTeam?: string;
  githubRepo?: string;
  agents: ManifestAgent[];
}

/** Plugin config file shape */
interface PluginConfigFile {
  agents: Record<string, Record<string, unknown>>;
}

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
const linearTeam = config.get("linearTeam") ?? "";
const githubRepo = config.get("githubRepo") ?? "";

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

// __dirname is dist/ when running compiled JS, so go up to project root
const manifestPath = path.join(__dirname, "..", "agent-army.yaml");
if (!fs.existsSync(manifestPath)) {
  throw new Error(
    "agent-army.yaml not found. Run `agent-army init` to create it."
  );
}

const manifest: Manifest = YAML.parse(fs.readFileSync(manifestPath, "utf-8"));

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
  agent: ManifestAgent,
  identityDefaults?: Record<string, Record<string, unknown>>,
  identityPlugins?: string[]
): { plugins: PluginInstallConfig[]; pluginSecrets: Record<string, pulumi.Output<string>>; enableFunnel: boolean } {
  const plugins: PluginInstallConfig[] = [];
  const pluginSecrets: Record<string, pulumi.Output<string>> = {};
  let enableFunnel = false;

  // Use agent's plugins, falling back to identity's recommended plugins
  const pluginList = agent.plugins ?? identityPlugins ?? [];

  for (const pluginName of pluginList) {
    const pluginCfg = pluginConfigs[pluginName];
    const userConfig = pluginCfg?.agents?.[agent.role] ?? {};
    const identityConfig = identityDefaults?.[pluginName] ?? {};
    // Merge: identity defaults first, user config overrides
    const agentSection = { ...identityConfig, ...userConfig };
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

for (const agent of manifest.agents) {
  // Build workspace files
  let workspaceFiles: Record<string, string>;
  let clawhubSkillSlugs: string[] = [];
  let agentEmoji = "";
  let agentDisplayName = agent.displayName;
  let agentVolumeSize = agent.volumeSize;

  const templateVars: Record<string, string> = {
    OWNER_NAME: ownerName,
    TIMEZONE: timezone,
    WORKING_HOURS: workingHours,
    USER_NOTES: userNotes,
    LINEAR_TEAM: linearTeam,
    GITHUB_REPO: githubRepo,
  };

  // Track identity plugin/dep info for merging later
  let identityPluginDefaults: Record<string, Record<string, unknown>> | undefined;
  let identityPlugins: string[] | undefined;
  let identityDeps: string[] | undefined;

  // Per-agent model/codingAgent from identity (with hardcoded defaults for custom agents)
  let identityModel: string | undefined;
  let identityBackupModel: string | undefined;
  let identityCodingAgent: string | undefined;

  // Resolve identity source: explicit identity, legacy preset mapping, or custom
  const identitySource = agent.identity ?? (agent.preset ? PRESET_TO_IDENTITY[agent.preset] : undefined);

  if (identitySource) {
    // Identity-based agent (or legacy preset converted to identity)
    const identity = fetchIdentitySync(identitySource, identityCacheDir);

    // Identity files are the workspace files
    workspaceFiles = processTemplates(identity.files, templateVars);

    // Pull defaults from identity manifest (agent-level overrides take precedence)
    agentEmoji = identity.manifest.emoji ?? agentEmoji;
    agentDisplayName = agent.displayName || identity.manifest.displayName;
    agentVolumeSize = agent.volumeSize ?? identity.manifest.volumeSize ?? 30;

    // Capture identity plugin info for merging into plugin config
    identityPluginDefaults = identity.manifest.pluginDefaults;
    identityPlugins = identity.manifest.plugins;
    identityDeps = identity.manifest.deps;

    // Capture model/codingAgent from identity
    identityModel = identity.manifest.model;
    identityBackupModel = identity.manifest.backupModel;
    identityCodingAgent = identity.manifest.codingAgent;

    // Extract public (clawhub) skills from identity manifest
    const { public: publicSkills } = classifySkills(identity.manifest.skills);
    clawhubSkillSlugs = publicSkills.map((s) => s.slug);
  } else {
    // Custom agent with inline content (no identity)
    workspaceFiles = {};
    if (agent.soulContent) workspaceFiles["SOUL.md"] = agent.soulContent;
    if (agent.identityContent) workspaceFiles["IDENTITY.md"] = agent.identityContent;
  }

  // Build plugin configs for this agent (merge identity defaults if available)
  const { plugins, pluginSecrets, enableFunnel } = buildPluginsForAgent(agent, identityPluginDefaults, identityPlugins);

  // Resolve model/codingAgent: identity values with hardcoded defaults for custom agents
  const agentModel = identityModel ?? "anthropic/claude-opus-4-6";
  const agentBackupModel = identityBackupModel;
  const agentCodingAgent = identityCodingAgent ?? "claude-code";

  // Resolve deps: agent manifest overrides identity defaults
  const depNames = agent.deps ?? identityDeps ?? [];
  const resolvedDeps = resolveDeps(depNames);
  const depEntries = resolvedDeps.map(d => ({
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

  if (provider === "aws") {
    // AWS path: create OpenClawAgent with VPC args
    const agentResource = new OpenClawAgent(agent.name, {
      anthropicApiKey,
      tailscaleAuthKey,
      tailnetDnsName,
      instanceType: agent.instanceType ?? instanceType,
      volumeSize: agentVolumeSize ?? 30,
      model: agentModel,
      backupModel: agentBackupModel,
      codingAgent: agentCodingAgent,

      // Use shared VPC
      vpcId: sharedVpc!.vpcId,
      subnetId: sharedVpc!.subnetId,
      securityGroupId: sharedVpc!.securityGroupId,

      // Workspace files
      workspaceFiles,

      // Environment variables
      envVars: {
        AGENT_ROLE: agent.role,
        AGENT_NAME: agentDisplayName,
        AGENT_EMOJI: agentEmoji,
        ...agent.envVars,
      },

      // Plugins
      plugins,
      pluginSecrets,
      enableFunnel,

      // Public skills from clawhub
      clawhubSkills: clawhubSkillSlugs,

      // Deps
      deps: depEntries,
      depSecrets,

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
    // Hetzner path: create HetznerOpenClawAgent
    const agentResource = new HetznerOpenClawAgent(agent.name, {
      anthropicApiKey,
      tailscaleAuthKey,
      tailnetDnsName,
      serverType: agent.instanceType ?? instanceType,
      location: manifest.region,
      model: agentModel,
      backupModel: agentBackupModel,
      codingAgent: agentCodingAgent,

      // Workspace files
      workspaceFiles,

      // Environment variables
      envVars: {
        AGENT_ROLE: agent.role,
        AGENT_NAME: agentDisplayName,
        AGENT_EMOJI: agentEmoji,
        ...agent.envVars,
      },

      // Plugins
      plugins,
      pluginSecrets,
      enableFunnel,

      // Public skills from clawhub
      clawhubSkills: clawhubSkillSlugs,

      // Deps
      deps: depEntries,
      depSecrets,

      labels: {
        ...baseTags,
        AgentRole: agent.role,
        AgentName: agent.displayName,
      },
    });

    // Map serverId → instanceId so CLI tools work unchanged
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
