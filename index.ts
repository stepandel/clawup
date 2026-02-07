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

// -----------------------------------------------------------------------------
// Resource Tags
// -----------------------------------------------------------------------------

const baseTags = {
  Project: "agent-army",
  Environment: pulumi.getStack(),
  ManagedBy: "pulumi",
};

// -----------------------------------------------------------------------------
// Shared VPC (cost optimization - all agents share one VPC)
// -----------------------------------------------------------------------------

const sharedVpc = new SharedVpc("agent-army", {
  tags: baseTags,
});

// VPC outputs
export const vpcId = sharedVpc.vpcId;
export const subnetId = sharedVpc.subnetId;
export const securityGroupId = sharedVpc.securityGroupId;

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
