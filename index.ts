/**
 * Agent Army - Data-Driven Multi-Agent Pulumi Stack
 *
 * Reads agent-army.yaml manifest to dynamically deploy OpenClaw agents.
 * The manifest is created by `agent-army init` and serves as the single
 * source of truth for the agent fleet configuration.
 *
 * All agents share a single VPC for cost optimization.
 * Each agent loads workspace files from identity repos or presets.
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

/**
 * Known plugin secret env var mappings.
 * Maps plugin name → { configKey: envVarName }.
 */
const PLUGIN_SECRET_ENV_VARS: Record<string, Record<string, string>> = {
  "openclaw-linear": {
    apiKey: "LINEAR_API_KEY",
    webhookSecret: "LINEAR_WEBHOOK_SECRET",
  },
};

// -----------------------------------------------------------------------------
// Configuration from Pulumi Config / ESC
// -----------------------------------------------------------------------------

const config = new pulumi.Config();

const anthropicApiKey = config.requireSecret("anthropicApiKey");
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");
const tailnetDnsName = config.require("tailnetDnsName");
const instanceType = config.get("instanceType") ?? "t3.medium";
const defaultModel = config.get("defaultModel") ?? "anthropic/claude-opus-4-6";
const ownerName = config.get("ownerName") ?? "Boss";
const timezone = config.get("timezone") ?? "PST (America/Los_Angeles)";
const workingHours = config.get("workingHours") ?? "9am-6pm";
const userNotes = config.get("userNotes") ?? "No additional notes provided yet.";
const linearTeam = config.get("linearTeam") ?? "";
const githubRepo = config.get("githubRepo") ?? "";
const braveApiKey = config.getSecret("braveApiKey");

// Identity cache directory
const identityCacheDir = path.join(os.homedir(), ".agent-army", "identity-cache");

// Per-agent Slack credentials from config/ESC
// Pattern: <role>SlackBotToken, <role>SlackAppToken
const agentSlackCredentials: Record<string, { botToken?: pulumi.Output<string>; appToken?: pulumi.Output<string> }> = {};
const agentGithubCredentials: Record<string, pulumi.Output<string> | undefined> = {};

// Common roles to check for credentials
// Note: custom roles are handled below after manifest is loaded
const commonRoles = ["pm", "eng", "tester"];
for (const role of commonRoles) {
  const botToken = config.getSecret(`${role}SlackBotToken`);
  const appToken = config.getSecret(`${role}SlackAppToken`);
  if (botToken || appToken) {
    agentSlackCredentials[role] = { botToken, appToken };
  }

  const githubToken = config.getSecret(`${role}GithubToken`);
  if (githubToken) {
    agentGithubCredentials[role] = githubToken;
  }
}

// -----------------------------------------------------------------------------
// Helper: Load preset workspace files from disk
// -----------------------------------------------------------------------------

function loadPresetFiles(presetDir: string, baseDir: string = "base"): Record<string, string> {
  const files: Record<string, string> = {};
  const presetsPath = path.join(__dirname, "..", "presets");

  // Load base files first
  const basePath = path.join(presetsPath, baseDir);
  if (fs.existsSync(basePath)) {
    for (const filename of fs.readdirSync(basePath)) {
      const filePath = path.join(basePath, filename);
      if (fs.statSync(filePath).isFile()) {
        // Remove .tpl extension if present (template files)
        const outputName = filename.replace(/\.tpl$/, "");
        files[outputName] = fs.readFileSync(filePath, "utf-8");
      }
    }
  }

  // Load role-specific files (override base)
  const rolePath = path.join(presetsPath, presetDir);
  if (fs.existsSync(rolePath)) {
    for (const filename of fs.readdirSync(rolePath)) {
      const filePath = path.join(rolePath, filename);
      if (fs.statSync(filePath).isFile()) {
        // Remove .tpl extension if present (template files)
        const outputName = filename.replace(/\.tpl$/, "");
        files[outputName] = fs.readFileSync(filePath, "utf-8");
      }
    }
  }

  // Load shared skills from presets/skills/
  const skillsPath = path.join(presetsPath, "skills");
  if (fs.existsSync(skillsPath)) {
    for (const skillDir of fs.readdirSync(skillsPath)) {
      const skillDirPath = path.join(skillsPath, skillDir);
      if (fs.statSync(skillDirPath).isDirectory()) {
        for (const filename of fs.readdirSync(skillDirPath)) {
          const filePath = path.join(skillDirPath, filename);
          if (fs.statSync(filePath).isFile()) {
            // Remove .tpl extension if present (template files)
            const outputName = filename.replace(/\.tpl$/, "");
            files[`skills/${skillDir}/${outputName}`] = fs.readFileSync(filePath, "utf-8");
          }
        }
      }
    }
  }

  return files;
}

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

// Load credentials for any custom roles not in commonRoles
for (const agent of manifest.agents) {
  if (!commonRoles.includes(agent.role)) {
    const role = agent.role;
    const botToken = config.getSecret(`${role}SlackBotToken`);
    const appToken = config.getSecret(`${role}SlackAppToken`);
    if (botToken || appToken) {
      agentSlackCredentials[role] = { botToken, appToken };
    }
    const githubToken = config.getSecret(`${role}GithubToken`);
    if (githubToken) agentGithubCredentials[role] = githubToken;
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
  agent: ManifestAgent
): { plugins: PluginInstallConfig[]; pluginSecrets: Record<string, pulumi.Output<string>>; enableFunnel: boolean } {
  const plugins: PluginInstallConfig[] = [];
  const pluginSecrets: Record<string, pulumi.Output<string>> = {};
  let enableFunnel = false;

  for (const pluginName of agent.plugins ?? []) {
    const pluginCfg = pluginConfigs[pluginName];
    const agentSection = pluginCfg?.agents?.[agent.role] ?? {};
    const secretMapping = PLUGIN_SECRET_ENV_VARS[pluginName] ?? {};

    plugins.push({
      name: pluginName,
      config: agentSection,
      secretEnvVars: Object.keys(secretMapping).length > 0 ? secretMapping : undefined,
    });

    // Collect secret outputs from Pulumi config
    for (const [, envVar] of Object.entries(secretMapping)) {
      if (!pluginSecrets[envVar]) {
        // Derive Pulumi config key from role + env var pattern
        // e.g., LINEAR_API_KEY → <role>LinearApiKey
        const secret = config.getSecret(`${agent.role}${envVarToConfigKey(envVar)}`);
        if (secret) {
          pluginSecrets[envVar] = secret;
        }
      }
    }

    // Enable funnel if the plugin needs webhooks (openclaw-linear uses webhooks)
    if (pluginName === "openclaw-linear") {
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

  if (agent.identity) {
    // Identity-based agent: fetch from Git URL or local path
    const identity = fetchIdentitySync(agent.identity, identityCacheDir);

    // Identity files are the workspace files
    workspaceFiles = processTemplates(identity.files, templateVars);

    // Pull defaults from identity manifest (agent-level overrides take precedence)
    agentEmoji = identity.manifest.emoji ?? agentEmoji;
    agentDisplayName = agent.displayName || identity.manifest.displayName;
    agentVolumeSize = agent.volumeSize ?? identity.manifest.volumeSize ?? 30;
  } else if (agent.preset) {
    // Preset agent: load from presets directory (backward compat)
    workspaceFiles = processTemplates(loadPresetFiles(agent.preset), templateVars);
  } else {
    // Custom agent: load base files + inline content from manifest
    workspaceFiles = processTemplates(loadPresetFiles("base", "base"), templateVars);
    // Override base files with custom inline content if provided (deprecated path)
    if (agent.soulContent) workspaceFiles["SOUL.md"] = agent.soulContent;
    if (agent.identityContent) workspaceFiles["IDENTITY.md"] = agent.identityContent;
  }

  // Build plugin configs for this agent
  const { plugins, pluginSecrets, enableFunnel } = buildPluginsForAgent(agent);

  // Get per-agent credentials if available
  const slackCreds = agentSlackCredentials[agent.role];
  const githubToken = agentGithubCredentials[agent.role];

  if (provider === "aws") {
    // AWS path: create OpenClawAgent with VPC args
    const agentResource = new OpenClawAgent(agent.name, {
      anthropicApiKey,
      tailscaleAuthKey,
      tailnetDnsName,
      instanceType: agent.instanceType ?? instanceType,
      volumeSize: agentVolumeSize ?? 30,
      model: defaultModel,

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

      // Slack credentials (optional)
      slackBotToken: slackCreds?.botToken,
      slackAppToken: slackCreds?.appToken,

      // Plugins
      plugins,
      pluginSecrets,
      enableFunnel,

      // GitHub token (optional)
      githubToken,

      // Brave Search API key (optional, shared)
      braveApiKey,

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
      model: defaultModel,

      // Workspace files
      workspaceFiles,

      // Environment variables
      envVars: {
        AGENT_ROLE: agent.role,
        AGENT_NAME: agentDisplayName,
        AGENT_EMOJI: agentEmoji,
        ...agent.envVars,
      },

      // Slack credentials (optional)
      slackBotToken: slackCreds?.botToken,
      slackAppToken: slackCreds?.appToken,

      // Plugins
      plugins,
      pluginSecrets,
      enableFunnel,

      // GitHub token (optional)
      githubToken,

      // Brave Search API key (optional, shared)
      braveApiKey,

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
