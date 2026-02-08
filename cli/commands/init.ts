/**
 * agent-army init — Interactive setup wizard
 */

import * as p from "@clack/prompts";
import type { AgentDefinition, ArmyManifest } from "../types";
import {
  PRESETS,
  AWS_REGIONS,
  INSTANCE_TYPES,
  COST_ESTIMATES,
  KEY_INSTRUCTIONS,
} from "../lib/constants";
import { checkPrerequisites } from "../lib/prerequisites";
import { selectOrCreateStack, setConfig } from "../lib/pulumi";
import { saveManifest } from "../lib/config";
import { showBanner, handleCancel, exitWithError, formatCost, formatAgentList } from "../lib/ui";
import { capture } from "../lib/exec";

export async function initCommand(): Promise<void> {
  showBanner();

  // Step 1: Check prerequisites
  p.log.step("Checking prerequisites...");
  const prereqsOk = await checkPrerequisites();
  if (!prereqsOk) {
    exitWithError("Prerequisites not met. Please install the missing tools and try again.");
  }
  p.log.success("All prerequisites satisfied!");

  // Step 2: Collect basic config
  const basicConfig = await p.group(
    {
      stackName: () =>
        p.text({
          message: "Pulumi stack name",
          placeholder: "dev",
          defaultValue: "dev",
        }),
      region: () =>
        p.select({
          message: "AWS region",
          options: AWS_REGIONS,
          initialValue: "us-east-1",
        }),
      instanceType: () =>
        p.select({
          message: "Default instance type",
          options: INSTANCE_TYPES,
          initialValue: "t3.medium",
        }),
      ownerName: () =>
        p.text({
          message: "Owner name (for workspace templates)",
          placeholder: "Boss",
          defaultValue: "Boss",
        }),
    },
    {
      onCancel: () => {
        p.cancel("Setup cancelled.");
        process.exit(0);
      },
    }
  );

  // Step 3: Collect secrets
  p.log.step("Configure secrets");

  p.note(
    KEY_INSTRUCTIONS.anthropicApiKey.steps.join("\n"),
    KEY_INSTRUCTIONS.anthropicApiKey.title
  );

  const anthropicApiKey = await p.text({
    message: "Anthropic API key",
    placeholder: "sk-ant-...",
    validate: (val) => {
      if (!val.startsWith("sk-ant-")) return "Must start with sk-ant-";
    },
  });
  handleCancel(anthropicApiKey);

  p.note(
    KEY_INSTRUCTIONS.tailscaleAuthKey.steps.join("\n"),
    KEY_INSTRUCTIONS.tailscaleAuthKey.title
  );

  const tailscaleAuthKey = await p.password({
    message: "Tailscale auth key",
    validate: (val) => {
      if (!val.startsWith("tskey-auth-")) return "Must start with tskey-auth-";
    },
  });
  handleCancel(tailscaleAuthKey);

  p.note(
    KEY_INSTRUCTIONS.tailnetDnsName.steps.join("\n"),
    KEY_INSTRUCTIONS.tailnetDnsName.title
  );

  const tailnetDnsName = await p.text({
    message: "Tailnet DNS name",
    placeholder: "my-tailnet.ts.net",
    validate: (val) => {
      if (!val.endsWith(".ts.net")) return "Must end with .ts.net";
    },
  });
  handleCancel(tailnetDnsName);

  // Step 4: Choose agents
  p.log.step("Configure agents");

  const agentMode = await p.select({
    message: "How would you like to configure agents?",
    options: [
      { value: "presets", label: "Presets only", hint: "PM (Sage), Eng (Atlas), Tester (Scout)" },
      { value: "custom", label: "Custom only", hint: "Define your own agents" },
      { value: "mix", label: "Mix of both", hint: "Pick presets + add custom agents" },
    ],
  });
  handleCancel(agentMode);

  const agents: AgentDefinition[] = [];

  // Collect preset agents
  if (agentMode === "presets" || agentMode === "mix") {
    const selectedPresets = await p.multiselect({
      message: "Select preset agents",
      options: Object.entries(PRESETS).map(([key, preset]) => ({
        value: key,
        label: `${preset.displayName} (${preset.role})`,
        hint: preset.description,
      })),
      required: agentMode === "presets",
    });
    handleCancel(selectedPresets);

    for (const key of selectedPresets as string[]) {
      const preset = PRESETS[key as keyof typeof PRESETS];
      agents.push({
        name: preset.name,
        displayName: preset.displayName,
        role: preset.role,
        preset: preset.preset,
        volumeSize: preset.volumeSize,
      });
    }
  }

  // Collect custom agents
  if (agentMode === "custom" || agentMode === "mix") {
    let addMore = true;
    while (addMore) {
      const customAgent = await p.group(
        {
          name: () =>
            p.text({
              message: "Agent resource name",
              placeholder: "agent-researcher",
              validate: (val) => {
                if (!/^[a-z][a-z0-9-]*$/.test(val))
                  return "Must be lowercase alphanumeric with hyphens, starting with a letter";
              },
            }),
          displayName: () =>
            p.text({
              message: "Display name",
              placeholder: "Nova",
            }),
          role: () =>
            p.text({
              message: "Role identifier",
              placeholder: "researcher",
              validate: (val) => {
                if (!/^[a-z][a-z0-9-]*$/.test(val))
                  return "Must be lowercase alphanumeric with hyphens";
              },
            }),
          soulContent: () =>
            p.text({
              message: "Agent soul/personality description (optional)",
              placeholder: "You are a research agent specializing in...",
              defaultValue: "",
            }),
          volumeSize: () =>
            p.text({
              message: "Volume size in GB",
              placeholder: "30",
              defaultValue: "30",
              validate: (val) => {
                const n = parseInt(val, 10);
                if (isNaN(n) || n < 8 || n > 500) return "Must be between 8 and 500";
              },
            }),
        },
        {
          onCancel: () => {
            p.cancel("Setup cancelled.");
            process.exit(0);
          },
        }
      );

      const agentDef: AgentDefinition = {
        name: customAgent.name,
        displayName: customAgent.displayName,
        role: customAgent.role,
        preset: null,
        volumeSize: parseInt(customAgent.volumeSize, 10),
      };
      if (customAgent.soulContent) {
        agentDef.soulContent = customAgent.soulContent;
      }
      agents.push(agentDef);

      const more = await p.confirm({
        message: "Add another custom agent?",
        initialValue: false,
      });
      handleCancel(more);
      addMore = more as boolean;
    }
  }

  if (agents.length === 0) {
    exitWithError("No agents configured. At least one agent is required.");
  }

  // Step 5: Show summary
  const costPerAgent = COST_ESTIMATES[basicConfig.instanceType as string] ?? 30;
  const totalCost = agents.reduce((sum, a) => {
    const agentCost = COST_ESTIMATES[a.instanceType ?? (basicConfig.instanceType as string)] ?? costPerAgent;
    return sum + agentCost;
  }, 0);

  p.note(
    [
      `Stack:          ${basicConfig.stackName}`,
      `Region:         ${basicConfig.region}`,
      `Instance type:  ${basicConfig.instanceType}`,
      `Owner:          ${basicConfig.ownerName}`,
      ``,
      `Agents (${agents.length}):`,
      formatAgentList(agents),
      ``,
      `Estimated cost: ${formatCost(totalCost)}`,
    ].join("\n"),
    "Deployment Summary"
  );

  // Step 6: Confirm
  const confirmed = await p.confirm({
    message: "Proceed with setup?",
  });
  handleCancel(confirmed);
  if (!confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Step 7: Execute setup
  const s = p.spinner();

  // Select/create stack
  s.start("Selecting Pulumi stack...");
  const stackResult = selectOrCreateStack(basicConfig.stackName as string);
  if (!stackResult.ok) {
    s.stop("Failed to select/create stack");
    if (stackResult.error) p.log.error(stackResult.error);
    exitWithError(`Could not select or create Pulumi stack "${basicConfig.stackName}".`);
  }
  s.stop("Pulumi stack ready");

  // Set Pulumi config
  s.start("Setting Pulumi configuration...");
  setConfig("aws:region", basicConfig.region as string);
  setConfig("anthropicApiKey", anthropicApiKey as string, true);
  setConfig("tailscaleAuthKey", tailscaleAuthKey as string, true);
  setConfig("tailnetDnsName", tailnetDnsName as string);
  setConfig("instanceType", basicConfig.instanceType as string);
  setConfig("ownerName", basicConfig.ownerName as string);
  s.stop("Configuration saved");

  // Write manifest
  s.start("Writing agent-army.json manifest...");
  const manifest: ArmyManifest = {
    stackName: basicConfig.stackName as string,
    region: basicConfig.region as string,
    instanceType: basicConfig.instanceType as string,
    ownerName: basicConfig.ownerName as string,
    agents,
  };
  saveManifest(manifest);
  s.stop("Manifest written");

  // Install dependencies if needed
  const result = capture("ls", ["node_modules"]);
  if (result.exitCode !== 0) {
    s.start("Installing dependencies...");
    const installResult = capture("pnpm", ["install"]);
    if (installResult.exitCode !== 0) {
      s.stop("Failed to install dependencies");
      p.log.warn("Run 'pnpm install' manually before deploying.");
    } else {
      s.stop("Dependencies installed");
    }
  }

  p.outro("Setup complete! Run `agent-army deploy` to deploy your agents.");
}
