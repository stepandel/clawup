/**
 * agent-army init — Interactive setup wizard
 */

import { execSync } from "child_process";
import * as p from "@clack/prompts";
import type { AgentDefinition, ArmyManifest } from "../types";
import {
  PRESETS,
  PROVIDERS,
  AWS_REGIONS,
  HETZNER_LOCATIONS,
  INSTANCE_TYPES,
  HETZNER_SERVER_TYPES,
  COST_ESTIMATES,
  HETZNER_COST_ESTIMATES,
  KEY_INSTRUCTIONS,
  MODEL_PROVIDERS,
  slackAppManifest,
  CODING_CLIS,
} from "../lib/constants";
import type { ModelProviderKey } from "../lib/constants";
import { checkPrerequisites } from "../lib/prerequisites";
import { selectOrCreateStack, setConfig } from "../lib/pulumi";
import { saveManifest } from "../lib/config";
import { showBanner, handleCancel, exitWithError, formatCost, formatAgentList } from "../lib/ui";
import { capture } from "../lib/exec";

interface InitOptions {
  deploy?: boolean;
  yes?: boolean;
}

export async function initCommand(opts: InitOptions = {}): Promise<void> {
  showBanner();

  // Step 1: Check prerequisites
  p.log.step("Checking prerequisites...");
  const prereqsOk = await checkPrerequisites();
  if (!prereqsOk) {
    exitWithError("Prerequisites not met. Please install the missing tools and try again.");
  }
  p.log.success("All prerequisites satisfied!");

  // Step 2: Collect basic config
  const stackName = await p.text({
    message: "Pulumi stack name",
    placeholder: "dev",
    defaultValue: "dev",
  });
  handleCancel(stackName);

  const provider = await p.select({
    message: "Cloud provider",
    options: PROVIDERS.map((prov) => ({ value: prov.value, label: prov.label, hint: prov.hint })),
    initialValue: "aws",
  });
  handleCancel(provider);

  // Provider-specific region/location and instance type selection
  let region: string;
  let instanceType: string;

  if (provider === "aws") {
    const awsRegion = await p.select({
      message: "AWS region",
      options: AWS_REGIONS,
      initialValue: "us-east-1",
    });
    handleCancel(awsRegion);
    region = awsRegion as string;

    const awsInstanceType = await p.select({
      message: "Default instance type",
      options: INSTANCE_TYPES,
      initialValue: "t3.medium",
    });
    handleCancel(awsInstanceType);
    instanceType = awsInstanceType as string;
  } else {
    const hetznerLocation = await p.select({
      message: "Hetzner location",
      options: HETZNER_LOCATIONS,
      initialValue: "fsn1",
    });
    handleCancel(hetznerLocation);
    region = hetznerLocation as string;

    const hetznerServerType = await p.select({
      message: "Default server type",
      options: HETZNER_SERVER_TYPES,
      initialValue: "cx22",
    });
    handleCancel(hetznerServerType);
    instanceType = hetznerServerType as string;
  }

  const ownerName = await p.text({
    message: "Owner name (for workspace templates)",
    placeholder: "Boss",
    defaultValue: "Boss",
  });
  handleCancel(ownerName);

  const basicConfig = {
    stackName: stackName as string,
    provider: provider as "aws" | "hetzner",
    region,
    instanceType,
    ownerName: ownerName as string,
  };

  // Step 3: Collect model providers and secrets
  p.log.step("Configure model providers");

  // Select model providers
  const selectedProviders = await p.multiselect({
    message: "Select model providers to configure",
    options: Object.entries(MODEL_PROVIDERS).map(([key, provider]) => ({
      value: key as ModelProviderKey,
      label: provider.name,
      hint: key === "anthropic" ? "Required for backward compatibility" : undefined,
    })),
    required: true,
    initialValues: ["anthropic" as ModelProviderKey],
  });
  handleCancel(selectedProviders);

  // Ensure Anthropic is always included for backward compatibility
  const providers = selectedProviders as ModelProviderKey[];
  if (!providers.includes("anthropic")) {
    providers.unshift("anthropic");
    p.log.info("Added Anthropic provider (required for backward compatibility)");
  }

  // Collect API keys for each provider
  const modelApiKeys: Record<string, string> = {};
  let anthropicApiKey = "";

  for (const providerKey of providers) {
    const provider = MODEL_PROVIDERS[providerKey];
    const keyInstructions = providerKey === "anthropic"
      ? KEY_INSTRUCTIONS.anthropicApiKey
      : providerKey === "openai"
      ? KEY_INSTRUCTIONS.openaiApiKey
      : providerKey === "opencodezen"
      ? KEY_INSTRUCTIONS.opencodeZenApiKey
      : KEY_INSTRUCTIONS.googleApiKey;

    p.note(keyInstructions.steps.join("\n"), keyInstructions.title);

    const apiKey = await p.text({
      message: `${provider.name} API key`,
      placeholder: provider.keyPrefix ? `${provider.keyPrefix}...` : "your-api-key",
      validate: (val) => {
        if (!val) return "API key is required";
        if (provider.keyPrefix && !val.startsWith(provider.keyPrefix)) {
          return `Must start with ${provider.keyPrefix}`;
        }
      },
    });
    handleCancel(apiKey);

    modelApiKeys[provider.envVar] = apiKey as string;

    // Keep anthropicApiKey for backward compatibility
    if (providerKey === "anthropic") {
      anthropicApiKey = apiKey as string;
    }
  }

  // Select default model
  const allModels = providers.flatMap((providerKey) =>
    MODEL_PROVIDERS[providerKey].models.map((m) => ({
      ...m,
      provider: providerKey,
    }))
  );

  const defaultModel = await p.select({
    message: "Select default model for agents",
    options: allModels.map((m) => ({
      value: m.value,
      label: `${m.label} (${MODEL_PROVIDERS[m.provider].name})`,
    })),
    initialValue: allModels[0]?.value ?? "anthropic/claude-sonnet-4",
  });
  handleCancel(defaultModel);

  p.log.step("Configure infrastructure secrets");

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

  p.note(
    KEY_INSTRUCTIONS.tailscaleApiKey.steps.join("\n"),
    KEY_INSTRUCTIONS.tailscaleApiKey.title
  );

  const tailscaleApiKey = await p.text({
    message: "Tailscale API key (press Enter to skip)",
    placeholder: "tskey-api-... (optional)",
    defaultValue: "",
  });
  handleCancel(tailscaleApiKey);

  // Step 4: Choose agents
  p.log.step("Configure agents");

  const agentMode = await p.select({
    message: "How would you like to configure agents?",
    options: [
      { value: "presets", label: "Presets only", hint: "PM (Sage), Eng (Titus), Tester (Scout)" },
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

  // Step 5: Select coding CLIs
  p.log.step("Configure coding CLIs");

  const selectedCodingClis = await p.multiselect({
    message: "Select coding CLIs to install",
    options: Object.entries(CODING_CLIS).map(([key, cli]) => ({
      value: key,
      label: cli.displayName,
      hint: cli.description,
    })),
    initialValues: ["claude-code"],
    required: false,
  });
  handleCancel(selectedCodingClis);

  const codingClis = (selectedCodingClis as string[]).length > 0
    ? (selectedCodingClis as string[])
    : ["claude-code"]; // Default to claude-code if none selected

  // Note about API keys for non-Anthropic CLIs
  const nonAnthropicClis = codingClis.filter(cli => cli !== "claude-code");
  if (nonAnthropicClis.length > 0) {
    p.note(
      [
        "The following CLIs require API keys configured post-deployment:",
        ...nonAnthropicClis.map(cli => {
          if (cli === "codex") return "• Codex: Set OPENAI_API_KEY in agent's environment";
          if (cli === "amp") return "• Amp: Set AMP_API_KEY in agent's environment";
          if (cli === "opencode") return "• OpenCode: Set OPENCODE_API_KEY in agent's environment";
          return `• ${cli}: Configure API key in agent's environment`;
        }),
        "",
        "Add these to ~/.openclaw/openclaw.json under 'env' after deployment.",
      ].join("\n"),
      "API Keys Required"
    );
  }

  // Step 6: Configure integrations
  p.log.step("Configure integrations");

  // Slack and Linear are always required
  const integrations: string[] = ["slack", "linear"];

  // Brave Search is optional
  const addBrave = await p.confirm({
    message: "Configure Brave Search? (optional)",
    initialValue: false,
  });
  handleCancel(addBrave);
  if (addBrave) {
    integrations.push("brave");
  }

  // GitHub is optional
  const addGithub = await p.confirm({
    message: "Configure GitHub CLI? (optional)",
    initialValue: false,
  });
  handleCancel(addGithub);
  if (addGithub) {
    integrations.push("github");
  }

  // Per-agent integration credentials
  const integrationCredentials: Record<string, {
    slackBotToken?: string;
    slackAppToken?: string;
    linearApiKey?: string;
    braveSearchApiKey?: string;
    githubToken?: string;
  }> = {};

  for (const agent of agents) {
    integrationCredentials[agent.role] = {};
  }

  if (integrations.includes("slack")) {
    p.note(
      KEY_INSTRUCTIONS.slackCredentials.steps.join("\n"),
      KEY_INSTRUCTIONS.slackCredentials.title
    );

    for (const agent of agents) {
      // Copy manifest to clipboard for easy paste into Slack
      const manifest = slackAppManifest(agent.displayName);
      try {
        execSync(
          process.platform === "darwin" ? "pbcopy" : "xclip -selection clipboard",
          { input: manifest },
        );
        p.log.success(`Slack manifest for ${agent.displayName} copied to clipboard — paste it into Slack`);
      } catch {
        p.log.warn(`Could not copy to clipboard. Manifest for ${agent.displayName}:`);
        console.log(manifest);
      }

      const botToken = await p.password({
        message: `Slack Bot Token for ${agent.displayName} (${agent.role})`,
        validate: (val) => {
          if (!val.startsWith("xoxb-")) return "Must start with xoxb-";
        },
      });
      handleCancel(botToken);

      const appToken = await p.password({
        message: `Slack App Token for ${agent.displayName} (${agent.role})`,
        validate: (val) => {
          if (!val.startsWith("xapp-")) return "Must start with xapp-";
        },
      });
      handleCancel(appToken);

      integrationCredentials[agent.role].slackBotToken = botToken as string;
      integrationCredentials[agent.role].slackAppToken = appToken as string;
    }
  }

  if (integrations.includes("linear")) {
    p.note(
      KEY_INSTRUCTIONS.linearApiKey.steps.join("\n"),
      KEY_INSTRUCTIONS.linearApiKey.title
    );

    for (const agent of agents) {
      const linearKey = await p.password({
        message: `Linear API key for ${agent.displayName} (${agent.role})`,
        validate: (val) => {
          if (!val.startsWith("lin_api_")) return "Must start with lin_api_";
        },
      });
      handleCancel(linearKey);

      integrationCredentials[agent.role].linearApiKey = linearKey as string;
    }
  }

  if (integrations.includes("brave")) {
    p.note(
      KEY_INSTRUCTIONS.braveSearchApiKey.steps.join("\n"),
      KEY_INSTRUCTIONS.braveSearchApiKey.title
    );

    for (const agent of agents) {
      const braveKey = await p.password({
        message: `Brave Search API key for ${agent.displayName} (${agent.role})`,
        validate: (val) => {
          if (!val.startsWith("BSA")) return "Must start with BSA";
        },
      });
      handleCancel(braveKey);

      integrationCredentials[agent.role].braveSearchApiKey = braveKey as string;
    }
  }

  if (integrations.includes("github")) {
    p.note(
      KEY_INSTRUCTIONS.githubToken.steps.join("\n"),
      KEY_INSTRUCTIONS.githubToken.title
    );

    for (const agent of agents) {
      const githubKey = await p.text({
        message: `GitHub token for ${agent.displayName} (${agent.role}) — press Enter to skip`,
        placeholder: "ghp_... or github_pat_... (optional)",
        defaultValue: "",
        validate: (val) => {
          if (val && !val.startsWith("ghp_") && !val.startsWith("github_pat_")) {
            return "Must start with ghp_ or github_pat_ (or leave empty to skip)";
          }
        },
      });
      handleCancel(githubKey);

      if (githubKey) {
        integrationCredentials[agent.role].githubToken = githubKey as string;
      }
    }
  }

  // Step 7: Show summary
  const costEstimates = basicConfig.provider === "aws" ? COST_ESTIMATES : HETZNER_COST_ESTIMATES;
  const costPerAgent = costEstimates[basicConfig.instanceType as string] ?? 30;
  const totalCost = agents.reduce((sum, a) => {
    const agentCost = costEstimates[a.instanceType ?? (basicConfig.instanceType as string)] ?? costPerAgent;
    return sum + agentCost;
  }, 0);

  const integrationNames = integrations.map(i => {
    if (i === "slack") return "Slack";
    if (i === "linear") return "Linear";
    if (i === "brave") return "Brave Search";
    if (i === "github") return "GitHub CLI";
    return i;
  });

  const providerLabel = basicConfig.provider === "aws" ? "AWS" : "Hetzner";
  const regionLabel = basicConfig.provider === "aws" ? "Region" : "Location";
  const codingCliNames = codingClis.map(cli => CODING_CLIS[cli as keyof typeof CODING_CLIS]?.displayName ?? cli);
  const providerNames = providers.map((p) => MODEL_PROVIDERS[p].name);

  p.note(
    [
      `Stack:          ${basicConfig.stackName}`,
      `Provider:       ${providerLabel}`,
      `${regionLabel.padEnd(14, " ")} ${basicConfig.region}`,
      `Instance type:  ${basicConfig.instanceType}`,
      `Owner:          ${basicConfig.ownerName}`,
      `Coding CLIs:    ${codingCliNames.join(", ")}`,
      `Model providers: ${providerNames.join(", ")}`,
      `Default model:  ${String(defaultModel)}`,
      `Integrations:   ${integrationNames.join(", ")}`,
      ``,
      `Agents (${agents.length}):`,
      formatAgentList(agents),
      ``,
      `Estimated cost: ${formatCost(totalCost)}`,
    ].join("\n"),
    "Deployment Summary"
  );

  // Step 8: Confirm
  const confirmed = await p.confirm({
    message: "Proceed with setup?",
  });
  handleCancel(confirmed);
  if (!confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Step 9: Execute setup
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
  setConfig("provider", basicConfig.provider);
  if (basicConfig.provider === "aws") {
    setConfig("aws:region", basicConfig.region);
  } else {
    setConfig("hetzner:location", basicConfig.region);
  }
  setConfig("anthropicApiKey", anthropicApiKey as string, true);
  setConfig("tailscaleAuthKey", tailscaleAuthKey as string, true);
  setConfig("tailnetDnsName", tailnetDnsName as string);
  if (tailscaleApiKey) {
    setConfig("tailscaleApiKey", tailscaleApiKey as string, true);
  }
  setConfig("instanceType", basicConfig.instanceType as string);
  setConfig("ownerName", basicConfig.ownerName as string);
  setConfig("defaultModel", defaultModel as string);
  // Set model API keys for each provider
  for (const [envVar, apiKey] of Object.entries(modelApiKeys)) {
    setConfig(envVar, apiKey, true);
  }
  // Set per-agent integration credentials
  for (const [role, creds] of Object.entries(integrationCredentials)) {
    if (creds.slackBotToken) setConfig(`${role}SlackBotToken`, creds.slackBotToken, true);
    if (creds.slackAppToken) setConfig(`${role}SlackAppToken`, creds.slackAppToken, true);
    if (creds.linearApiKey) setConfig(`${role}LinearApiKey`, creds.linearApiKey, true);
    if (creds.braveSearchApiKey) setConfig(`${role}BraveSearchApiKey`, creds.braveSearchApiKey, true);
    if (creds.githubToken) setConfig(`${role}GithubToken`, creds.githubToken, true);
  }
  s.stop("Configuration saved");

  // Write manifest
  const configName = basicConfig.stackName as string;
  s.start(`Writing config to ~/.agent-army/configs/${configName}.json...`);
  const manifest: ArmyManifest = {
    stackName: configName,
    provider: basicConfig.provider as "aws" | "hetzner",
    region: basicConfig.region as string,
    instanceType: basicConfig.instanceType as string,
    ownerName: basicConfig.ownerName as string,
    agents,
    codingClis,
  };
  saveManifest(configName, manifest);
  s.stop("Config saved");

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

  if (opts.deploy) {
    p.log.success("Config saved! Starting deployment...\n");
    const { deployCommand } = await import("./deploy.js");
    await deployCommand({ config: configName, yes: opts.yes });
  } else {
    p.outro("Setup complete! Run `agent-army deploy` to deploy your agents.");
  }
}
