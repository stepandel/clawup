/**
 * Agent Army - Data-Driven Multi-Agent Pulumi Stack
 *
 * Reads agent-army.json manifest to dynamically deploy OpenClaw agents.
 * The manifest is created by `agent-army init` and serves as the single
 * source of truth for the agent fleet configuration.
 *
 * All agents share a single VPC for cost optimization.
 * Each agent loads role-specific workspace files from presets.
 * Secrets are pulled from Pulumi config (set by CLI or ESC).
 */

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as path from "path";
import { OpenClawAgent } from "./src";
import { SharedVpc } from "./shared-vpc";

// -----------------------------------------------------------------------------
// Manifest type (duplicated here to avoid importing from cli/)
// -----------------------------------------------------------------------------

interface ManifestAgent {
  name: string;
  displayName: string;
  role: string;
  preset: string | null;
  volumeSize: number;
  instanceType?: string;
  soulContent?: string;
  identityContent?: string;
  envVars?: Record<string, string>;
}

interface Manifest {
  stackName: string;
  provider: "aws" | "hetzner";
  region: string;
  instanceType: string;
  ownerName: string;
  agents: ManifestAgent[];
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

// Per-agent Slack credentials from config/ESC
// Pattern: <role>SlackBotToken, <role>SlackAppToken
const agentSlackCredentials: Record<string, { botToken?: pulumi.Output<string>; appToken?: pulumi.Output<string> }> = {};
const agentLinearCredentials: Record<string, pulumi.Output<string> | undefined> = {};
const agentBraveSearchCredentials: Record<string, pulumi.Output<string> | undefined> = {};
const agentGithubCredentials: Record<string, pulumi.Output<string> | undefined> = {};

// Common roles to check for credentials
const commonRoles = ["pm", "eng", "tester"];
for (const role of commonRoles) {
  const botToken = config.getSecret(`${role}SlackBotToken`);
  const appToken = config.getSecret(`${role}SlackAppToken`);
  if (botToken || appToken) {
    agentSlackCredentials[role] = { botToken, appToken };
  }
  
  const linearToken = config.getSecret(`${role}LinearApiKey`);
  if (linearToken) {
    agentLinearCredentials[role] = linearToken;
  }
  
  const braveKey = config.getSecret(`${role}BraveSearchApiKey`);
  if (braveKey) {
    agentBraveSearchCredentials[role] = braveKey;
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
        files[filename] = fs.readFileSync(filePath, "utf-8");
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
// Load Manifest
// -----------------------------------------------------------------------------

// __dirname is dist/ when running compiled JS, so go up to project root
const manifestPath = path.join(__dirname, "..", "agent-army.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(
    "agent-army.json not found. Run `agent-army init` to create it."
  );
}

const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

// Default provider to AWS for backwards compatibility with existing manifests
const provider = manifest.provider ?? "aws";

// Validate provider
if (provider !== "aws" && provider !== "hetzner") {
  throw new Error(`Unsupported provider: ${provider}. Supported providers are: aws, hetzner`);
}

// Hetzner support is not yet implemented
if (provider === "hetzner") {
  throw new Error(
    "Hetzner provider is not yet implemented. Please use AWS for now."
  );
}

// -----------------------------------------------------------------------------
// Resource Tags
// -----------------------------------------------------------------------------

const baseTags = {
  Project: "agent-army",
  Environment: pulumi.getStack(),
  ManagedBy: "pulumi",
};

// -----------------------------------------------------------------------------
// Dynamic AZ Selection - Find an AZ that supports all instance types
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Shared VPC (cost optimization - all agents share one VPC)
// -----------------------------------------------------------------------------

const sharedVpc = new SharedVpc("agent-army", {
  availabilityZone: availabilityZone,
  tags: baseTags,
});

// VPC outputs
export const vpcId = sharedVpc.vpcId;
export const subnetId = sharedVpc.subnetId;
export const securityGroupId = sharedVpc.securityGroupId;
export const selectedAvailabilityZone = availabilityZone;

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

  if (agent.preset) {
    // Preset agent: load from presets directory
    workspaceFiles = processTemplates(loadPresetFiles(agent.preset), {
      OWNER_NAME: ownerName,
    });
  } else {
    // Custom agent: load base files + inline content from manifest
    workspaceFiles = processTemplates(loadPresetFiles("base", "base"), {
      OWNER_NAME: ownerName,
    });
    // Override base files with custom inline content if provided
    if (agent.soulContent) workspaceFiles["SOUL.md"] = agent.soulContent;
    if (agent.identityContent) workspaceFiles["IDENTITY.md"] = agent.identityContent;
  }

  // Get per-agent credentials if available
  const slackCreds = agentSlackCredentials[agent.role];
  const linearApiKey = agentLinearCredentials[agent.role];
  const braveSearchApiKey = agentBraveSearchCredentials[agent.role];
  const githubToken = agentGithubCredentials[agent.role];

  const agentResource = new OpenClawAgent(agent.name, {
    anthropicApiKey,
    tailscaleAuthKey,
    tailnetDnsName,
    instanceType: agent.instanceType ?? instanceType,
    volumeSize: agent.volumeSize ?? 30,

    // Use shared VPC
    vpcId: sharedVpc.vpcId,
    subnetId: sharedVpc.subnetId,
    securityGroupId: sharedVpc.securityGroupId,

    // Workspace files
    workspaceFiles,

    // Environment variables
    envVars: {
      AGENT_ROLE: agent.role,
      AGENT_NAME: agent.displayName,
      ...agent.envVars,
    },

    // Slack credentials (optional)
    slackBotToken: slackCreds?.botToken,
    slackAppToken: slackCreds?.appToken,

    // Linear API key (optional)
    linearApiKey,

    // Brave Search API key (optional)
    braveSearchApiKey,

    // GitHub token (optional)
    githubToken,

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
}
