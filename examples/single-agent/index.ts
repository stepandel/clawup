/**
 * Example: Deploy a single OpenClaw agent on AWS
 *
 * Setup:
 * 1. Configure Pulumi ESC with your secrets (recommended)
 * 2. Or set config values: pulumi config set --secret anthropicApiKey sk-ant-...
 */

import * as pulumi from "@pulumi/pulumi";
import { OpenClawAgent } from "../../src";

const config = new pulumi.Config();

// Required configuration
const anthropicApiKey = config.requireSecret("anthropicApiKey");
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");
const tailnetDnsName = config.require("tailnetDnsName");

// Optional configuration
const instanceType = config.get("instanceType") ?? "t3.medium";

// Deploy the agent
const agent = new OpenClawAgent("my-openclaw-agent", {
  anthropicApiKey,
  tailscaleAuthKey,
  tailnetDnsName,
  instanceType,

  // Optional: inject workspace files
  workspaceFiles: {
    "AGENTS.md": `# My OpenClaw Agent
This agent was deployed via Pulumi!
`,
  },

  // Optional: additional environment variables
  envVars: {
    AGENT_NAME: "my-openclaw-agent",
  },

  // Optional: resource tags
  tags: {
    Environment: "production",
    ManagedBy: "pulumi",
  },
});

// Export outputs
export const publicIp = agent.publicIp;
export const publicDns = agent.publicDns;
export const tailscaleUrl = agent.tailscaleUrl;
export const gatewayToken = agent.gatewayToken;
export const sshPrivateKey = pulumi.secret(agent.sshPrivateKey);
