/**
 * Example: Deploy OpenClaw agent into an existing VPC
 *
 * Use this when you have an existing AWS infrastructure
 * and want to add an OpenClaw agent to it.
 */

import * as pulumi from "@pulumi/pulumi";
import { OpenClawAgent } from "../../src";

const config = new pulumi.Config();

// Required configuration
const anthropicApiKey = config.requireSecret("anthropicApiKey");
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");
const tailnetDnsName = config.require("tailnetDnsName");

// Existing infrastructure
const vpcId = config.require("vpcId");
const subnetId = config.require("subnetId");
const securityGroupId = config.get("securityGroupId"); // Optional

// Deploy the agent into existing VPC
const agent = new OpenClawAgent("existing-vpc-agent", {
  anthropicApiKey,
  tailscaleAuthKey,
  tailnetDnsName,

  // Use existing infrastructure
  vpcId,
  subnetId,
  securityGroupId, // Optional - will create one if not provided

  // Larger instance for heavy workloads
  instanceType: "t3.large",
  volumeSize: 50,

  tags: {
    Environment: "production",
    Team: "platform",
  },
});

export const publicIp = agent.publicIp;
export const tailscaleUrl = agent.tailscaleUrl;
export const instanceId = agent.instanceId;
