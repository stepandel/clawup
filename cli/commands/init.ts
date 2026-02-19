/**
 * agent-army init — Interactive setup wizard
 */

import { execSync } from "child_process";
import * as p from "@clack/prompts";
import type { AgentDefinition, ArmyManifest } from "../types";
import { fetchIdentity } from "../lib/identity";
import * as os from "os";
import * as path from "path";
import {
  BUILT_IN_IDENTITIES,
  PROVIDERS,
  AWS_REGIONS,
  HETZNER_LOCATIONS,
  INSTANCE_TYPES,
  hetznerServerTypes,
  COST_ESTIMATES,
  HETZNER_COST_ESTIMATES,
  KEY_INSTRUCTIONS,
  MODEL_PROVIDERS,
  slackAppManifest,
  tailscaleHostname,
} from "../lib/constants";
import { checkPrerequisites } from "../lib/prerequisites";
import { selectOrCreateStack, setConfig } from "../lib/pulumi";
import { saveManifest, savePluginConfig } from "../lib/config";
import type { PluginConfigFile } from "../types";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { showBanner, handleCancel, exitWithError, formatCost, formatAgentList } from "../lib/ui";

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

    const serverTypeOptions = hetznerServerTypes(region);
    const hetznerServerType = await p.select({
      message: "Default server type",
      options: serverTypeOptions,
      initialValue: serverTypeOptions[0].value,
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

  const timezone = await p.text({
    message: "Your timezone",
    placeholder: "PST (America/Los_Angeles)",
    defaultValue: "PST (America/Los_Angeles)",
  });
  handleCancel(timezone);

  const workingHours = await p.text({
    message: "Your working hours",
    placeholder: "9am-6pm",
    defaultValue: "9am-6pm",
  });
  handleCancel(workingHours);

  const userNotes = await p.text({
    message: "Any notes for your agents about you? (optional)",
    placeholder: "e.g., Prefers concise updates, hates unnecessary meetings",
    defaultValue: "",
  });
  handleCancel(userNotes);

  // Project-specific config for bootstrap
  const linearTeam = await p.text({
    message: "Default Linear team id (used in bootstrap integration check)",
    placeholder: "e.g., ENG, AGE, PROJ",
    validate: (val) => {
      if (!val) return "Default Linear team id is required";
    },
  });
  handleCancel(linearTeam);

  const githubRepo = await p.text({
    message: "Default GitHub repo URL (used in bootstrap integration check)",
    placeholder: "https://github.com/org/repo",
    validate: (val) => {
      if (!val) return "Default GitHub repo URL is required";
      if (!val.startsWith("https://github.com/")) return "Must be a GitHub HTTPS URL";
    },
  });
  handleCancel(githubRepo);

  const basicConfig = {
    stackName: stackName as string,
    provider: provider as "aws" | "hetzner",
    region,
    instanceType,
    ownerName: ownerName as string,
    timezone: timezone as string,
    workingHours: workingHours as string,
    userNotes: (userNotes as string) || "No additional notes provided yet.",
    linearTeam: linearTeam as string,
    githubRepo: githubRepo as string,
  };

  // Step 3: Collect Anthropic API key and model
  p.log.step("Configure Anthropic API key");

  p.note(
    KEY_INSTRUCTIONS.anthropicApiKey.steps.join("\n"),
    KEY_INSTRUCTIONS.anthropicApiKey.title
  );

  const anthropicApiKey = await p.text({
    message: "Anthropic API key",
    placeholder: `${MODEL_PROVIDERS.anthropic.keyPrefix}...`,
    validate: (val) => {
      if (!val) return "API key is required";
      if (!val.startsWith(MODEL_PROVIDERS.anthropic.keyPrefix)) {
        return `Must start with ${MODEL_PROVIDERS.anthropic.keyPrefix}`;
      }
    },
  });
  handleCancel(anthropicApiKey);

  // Select default model (Anthropic models only)
  const defaultModel = await p.select({
    message: "Select default model for agents",
    options: MODEL_PROVIDERS.anthropic.models.map((m) => ({
      value: m.value,
      label: m.label,
    })),
    initialValue: MODEL_PROVIDERS.anthropic.models[0]?.value ?? "anthropic/claude-sonnet-4-5",
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

  // Hetzner API token (required for Hetzner provider)
  let hcloudToken: string | undefined;
  if (provider === "hetzner") {
    p.note(
      KEY_INSTRUCTIONS.hcloudToken.steps.join("\n"),
      KEY_INSTRUCTIONS.hcloudToken.title
    );

    const token = await p.password({
      message: "Hetzner Cloud API token",
      validate: (val) => {
        if (!val) return "API token is required for Hetzner deployments";
      },
    });
    handleCancel(token);
    hcloudToken = token as string;
  }

  // Step 4: Choose agents
  p.log.step("Configure agents");

  const agentMode = await p.select({
    message: "How would you like to configure agents?",
    options: [
      { value: "built-in", label: "Built-in agents", hint: "PM (Juno), Eng (Titus), QA (Scout)" },
      { value: "identity", label: "From identity repo", hint: "Load agent personas from a Git URL or local path" },
      { value: "custom", label: "Custom only", hint: "Define your own agents" },
      { value: "mix", label: "Mix of both", hint: "Pick built-in + add custom agents" },
    ],
  });
  handleCancel(agentMode);

  const agents: AgentDefinition[] = [];
  // Track identity pluginDefaults per role for seeding plugin config files
  const identityPluginDefaults: Record<string, Record<string, Record<string, unknown>>> = {};
  const identityCacheDir = path.join(os.homedir(), ".agent-army", "identity-cache");

  // Collect built-in agents (loaded via identity system)
  if (agentMode === "built-in" || agentMode === "mix") {
    const selectedBuiltIns = await p.multiselect({
      message: "Select agents",
      options: Object.entries(BUILT_IN_IDENTITIES).map(([key, entry]) => ({
        value: key,
        label: entry.label,
        hint: entry.hint,
      })),
      required: agentMode === "built-in",
    });
    handleCancel(selectedBuiltIns);

    for (const key of selectedBuiltIns as string[]) {
      const entry = BUILT_IN_IDENTITIES[key];
      const identity = await fetchIdentity(entry.path, identityCacheDir);
      agents.push({
        name: `agent-${identity.manifest.name}`,
        displayName: identity.manifest.displayName,
        role: identity.manifest.role,
        preset: null,
        identity: entry.path,
        volumeSize: identity.manifest.volumeSize,
        plugins: identity.manifest.plugins ?? ["openclaw-linear"],
      });

      if (identity.manifest.pluginDefaults) {
        identityPluginDefaults[identity.manifest.role] = identity.manifest.pluginDefaults;
      }
    }
  }

  // Collect identity-based agents
  if (agentMode === "identity" || agentMode === "mix") {
    let addMore = true;

    while (addMore) {
      const identityUrl = await p.text({
        message: "Identity source (Git URL or local path)",
        placeholder: "https://github.com/org/identities#agent-name",
        validate: (val) => {
          if (!val.trim()) return "Identity source is required";
        },
      });
      handleCancel(identityUrl);

      // Validate by fetching the identity
      const spinner = p.spinner();
      spinner.start("Validating identity...");

      try {
        const identity = await fetchIdentity(identityUrl as string, identityCacheDir);
        spinner.stop(
          `Found: ${identity.manifest.displayName} (${identity.manifest.role}) — ${identity.manifest.description}`
        );

        // Allow volume size override
        const volumeOverride = await p.text({
          message: `Volume size in GB (default: ${identity.manifest.volumeSize})`,
          placeholder: String(identity.manifest.volumeSize),
          defaultValue: String(identity.manifest.volumeSize),
          validate: (val) => {
            const n = parseInt(val, 10);
            if (isNaN(n) || n < 8 || n > 500) return "Must be between 8 and 500";
          },
        });
        handleCancel(volumeOverride);

        agents.push({
          name: `agent-${identity.manifest.name}`,
          displayName: identity.manifest.displayName,
          role: identity.manifest.role,
          preset: null,
          identity: identityUrl as string,
          volumeSize: parseInt(volumeOverride as string, 10),
          plugins: identity.manifest.plugins ?? ["openclaw-linear"],
        });

        // Track identity pluginDefaults for seeding plugin config files
        if (identity.manifest.pluginDefaults) {
          identityPluginDefaults[identity.manifest.role] = identity.manifest.pluginDefaults;
        }
      } catch (err) {
        spinner.stop(`Failed to validate identity: ${(err as Error).message}`);
        p.log.error("Please check the URL and try again.");
        continue; // Re-prompt
      }

      const more = await p.confirm({
        message: "Add another identity-based agent?",
        initialValue: false,
      });
      handleCancel(more);
      addMore = more as boolean;
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
        plugins: ["openclaw-linear"],
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

  // Step 5: Configure integrations
  p.log.step("Configure integrations");

  // Required integrations
  const integrations: string[] = ["linear", "github"];

  // Check if any agent uses the Slack plugin
  const hasSlackPlugin = agents.some((a) => a.plugins?.includes("slack"));

  // Per-agent integration credentials
  const integrationCredentials: Record<string, {
    linearApiKey?: string;
    linearWebhookSecret?: string;
    linearUserUuid?: string;
    githubToken?: string;
  }> = {};

  for (const agent of agents) {
    integrationCredentials[agent.role] = {};
  }

  // Slack credentials — driven by plugin presence
  const slackCredentials: Record<string, { botToken: string; appToken: string }> = {};
  if (hasSlackPlugin) {
    p.note(
      KEY_INSTRUCTIONS.slackCredentials.steps.join("\n"),
      KEY_INSTRUCTIONS.slackCredentials.title
    );

    for (const agent of agents) {
      if (!agent.plugins?.includes("slack")) continue;

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

      slackCredentials[agent.role] = {
        botToken: botToken as string,
        appToken: appToken as string,
      };
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

      // Auto-fetch user UUID from Linear API
      const s = p.spinner();
      s.start(`Fetching Linear user ID for ${agent.displayName}...`);
      try {
        const res = await fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: linearKey as string,
          },
          body: JSON.stringify({ query: "{ viewer { id } }" }),
        });
        const data = (await res.json()) as { data?: { viewer?: { id?: string } } };
        const uuid = data?.data?.viewer?.id;
        if (!uuid) throw new Error("No user ID in response");
        integrationCredentials[agent.role].linearUserUuid = uuid;
        s.stop(`${agent.displayName}: ${uuid}`);
      } catch (err) {
        s.stop(`Could not fetch Linear user ID for ${agent.displayName}`);
        p.log.warn(`${err instanceof Error ? err.message : String(err)}`);
        const linearUserUuid = await p.text({
          message: `Enter Linear user UUID manually for ${agent.displayName}`,
          placeholder: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          validate: (val) => {
            if (!val) return "Linear user UUID is required";
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
              return "Must be a valid UUID format";
            }
          },
        });
        handleCancel(linearUserUuid);
        integrationCredentials[agent.role].linearUserUuid = linearUserUuid as string;
      }
    }

    // Per-agent Linear webhook signing secret
    // The webhook URL is deterministic, so we can show it before deploy
    p.note(
      [
        "Create a webhook in Linear for each agent:",
        "1. Go to Settings → API → Webhooks → \"New webhook\"",
        "2. Paste the webhook URL shown below for each agent",
        "3. Select events to receive (e.g., Issues, Comments)",
        "4. Copy the \"Signing secret\" shown after creating the webhook",
      ].join("\n"),
      "Linear Webhook Setup"
    );

    for (const agent of agents) {
      const webhookUrl = `https://${tailscaleHostname(basicConfig.stackName as string, agent.name)}.${tailnetDnsName as string}/hooks/linear`;

      p.log.info(`${agent.displayName} (${agent.role}): ${webhookUrl}`);

      const webhookSecretInput = await p.password({
        message: `Signing secret for ${agent.displayName} (${agent.role})`,
        validate: (val) => {
          if (!val) return "Webhook signing secret is required";
        },
      });
      handleCancel(webhookSecretInput);

      integrationCredentials[agent.role].linearWebhookSecret = webhookSecretInput as string;
    }
  }

  if (integrations.includes("github")) {
    p.note(
      KEY_INSTRUCTIONS.githubToken.steps.join("\n"),
      KEY_INSTRUCTIONS.githubToken.title
    );

    for (const agent of agents) {
      const githubKey = await p.password({
        message: `GitHub token for ${agent.displayName} (${agent.role})`,
        validate: (val) => {
          if (!val.startsWith("ghp_") && !val.startsWith("github_pat_")) {
            return "Must start with ghp_ or github_pat_";
          }
        },
      });
      handleCancel(githubKey);

      integrationCredentials[agent.role].githubToken = githubKey as string;
    }
  }

  // Optional: Brave Search API key (shared across all agents)
  const braveApiKeyPrompt = await p.confirm({
    message: "Add a Brave Search API key for web search? (optional)",
    initialValue: false,
  });
  handleCancel(braveApiKeyPrompt);

  let braveApiKey: string | undefined;
  if (braveApiKeyPrompt) {
    p.note(
      KEY_INSTRUCTIONS.braveApiKey.steps.join("\n"),
      KEY_INSTRUCTIONS.braveApiKey.title
    );

    const braveKey = await p.password({
      message: "Brave Search API key",
      validate: (val) => {
        if (!val) return "API key is required";
      },
    });
    handleCancel(braveKey);
    braveApiKey = braveKey as string;
  }

  // Step 7: Show summary
  const costEstimates = basicConfig.provider === "aws" ? COST_ESTIMATES : HETZNER_COST_ESTIMATES;
  const costPerAgent = costEstimates[basicConfig.instanceType as string] ?? 30;
  const totalCost = agents.reduce((sum, a) => {
    const agentCost = costEstimates[a.instanceType ?? (basicConfig.instanceType as string)] ?? costPerAgent;
    return sum + agentCost;
  }, 0);

  const integrationNames = [
    ...(hasSlackPlugin ? ["Slack"] : []),
    ...integrations.map(i => {
      if (i === "linear") return "Linear";
      if (i === "github") return "GitHub CLI";
      return i;
    }),
  ];

  const providerLabel = basicConfig.provider === "aws" ? "AWS" : "Hetzner";
  const regionLabel = basicConfig.provider === "aws" ? "Region" : "Location";

  p.note(
    [
      `Stack:          ${basicConfig.stackName}`,
      `Provider:       ${providerLabel}`,
      `${regionLabel.padEnd(14, " ")} ${basicConfig.region}`,
      `Instance type:  ${basicConfig.instanceType}`,
      `Owner:          ${basicConfig.ownerName}`,
      `Timezone:       ${basicConfig.timezone}`,
      `Working hours:  ${basicConfig.workingHours}`,
      `Linear team:    ${basicConfig.linearTeam}`,
      `GitHub repo:    ${basicConfig.githubRepo}`,
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

  // Set up workspace (installs Pulumi SDK deps on first run, no-op in dev mode)
  s.start("Setting up workspace...");
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    s.stop("Failed to set up workspace");
    exitWithError(wsResult.error ?? "Failed to set up workspace.");
  }
  s.stop("Workspace ready");
  const cwd = getWorkspaceDir();

  // Select/create stack
  s.start("Selecting Pulumi stack...");
  const stackResult = selectOrCreateStack(basicConfig.stackName as string, cwd);
  if (!stackResult.ok) {
    s.stop("Failed to select/create stack");
    if (stackResult.error) p.log.error(stackResult.error);
    exitWithError(`Could not select or create Pulumi stack "${basicConfig.stackName}".`);
  }
  s.stop("Pulumi stack ready");

  // Set Pulumi config
  s.start("Setting Pulumi configuration...");
  setConfig("provider", basicConfig.provider, false, cwd);
  if (basicConfig.provider === "aws") {
    setConfig("aws:region", basicConfig.region, false, cwd);
  } else {
    setConfig("hetzner:location", basicConfig.region, false, cwd);
    if (hcloudToken) {
      setConfig("hcloud:token", hcloudToken, true, cwd);
    }
  }
  setConfig("anthropicApiKey", anthropicApiKey as string, true, cwd);
  setConfig("tailscaleAuthKey", tailscaleAuthKey as string, true, cwd);
  setConfig("tailnetDnsName", tailnetDnsName as string, false, cwd);
  if (tailscaleApiKey) {
    setConfig("tailscaleApiKey", tailscaleApiKey as string, true, cwd);
  }
  setConfig("instanceType", basicConfig.instanceType as string, false, cwd);
  setConfig("ownerName", basicConfig.ownerName as string, false, cwd);
  setConfig("timezone", basicConfig.timezone as string, false, cwd);
  setConfig("workingHours", basicConfig.workingHours as string, false, cwd);
  setConfig("userNotes", basicConfig.userNotes as string, false, cwd);
  setConfig("linearTeam", basicConfig.linearTeam as string, false, cwd);
  setConfig("githubRepo", basicConfig.githubRepo as string, false, cwd);
  setConfig("defaultModel", defaultModel as string, false, cwd);
  // Set per-agent integration credentials
  for (const [role, creds] of Object.entries(integrationCredentials)) {
    if (creds.linearApiKey) setConfig(`${role}LinearApiKey`, creds.linearApiKey, true, cwd);
    if (creds.linearWebhookSecret) setConfig(`${role}LinearWebhookSecret`, creds.linearWebhookSecret, true, cwd);
    if (creds.linearUserUuid) setConfig(`${role}LinearUserUuid`, creds.linearUserUuid, false, cwd);
    if (creds.githubToken) setConfig(`${role}GithubToken`, creds.githubToken, true, cwd);
  }
  // Set per-agent Slack credentials (driven by plugin presence)
  for (const [role, creds] of Object.entries(slackCredentials)) {
    setConfig(`${role}SlackBotToken`, creds.botToken, true, cwd);
    setConfig(`${role}SlackAppToken`, creds.appToken, true, cwd);
  }
  if (braveApiKey) setConfig("braveApiKey", braveApiKey, true, cwd);
  s.stop("Configuration saved");

  // Write manifest
  const configName = basicConfig.stackName as string;
  s.start(`Writing config to ~/.agent-army/configs/${configName}.yaml...`);
  const manifest: ArmyManifest = {
    stackName: configName,
    provider: basicConfig.provider as "aws" | "hetzner",
    region: basicConfig.region as string,
    instanceType: basicConfig.instanceType as string,
    ownerName: basicConfig.ownerName as string,
    timezone: basicConfig.timezone as string,
    workingHours: basicConfig.workingHours as string,
    userNotes: basicConfig.userNotes as string,
    linearTeam: basicConfig.linearTeam as string,
    githubRepo: basicConfig.githubRepo as string,
    agents,
  };
  saveManifest(configName, manifest);

  // Build and save plugin config files
  // Collect all unique plugin names across agents
  const allPlugins = new Set<string>();
  for (const agent of agents) {
    for (const p of agent.plugins ?? []) allPlugins.add(p);
  }

  for (const pluginName of allPlugins) {
    const pluginAgents: Record<string, Record<string, unknown>> = {};

    for (const agent of agents) {
      if (!agent.plugins?.includes(pluginName)) continue;

      // Start with identity pluginDefaults if available
      const defaults = identityPluginDefaults[agent.role]?.[pluginName] ?? {};
      const agentConfig: Record<string, unknown> = {
        ...defaults,
        agentId: agent.name,
      };

      // Layer on user-provided config (e.g., Linear credentials from init)
      if (pluginName === "openclaw-linear") {
        const creds = integrationCredentials[agent.role];
        if (creds?.linearUserUuid) {
          agentConfig.linearUserUuid = creds.linearUserUuid;
        }
      }

      pluginAgents[agent.role] = agentConfig;
    }

    if (Object.keys(pluginAgents).length > 0) {
      const pluginConfig: PluginConfigFile = { agents: pluginAgents };
      savePluginConfig(configName, pluginName, pluginConfig);
    }
  }

  s.stop("Config saved");

  if (opts.deploy) {
    p.log.success("Config saved! Starting deployment...\n");
    const { deployCommand } = await import("./deploy.js");
    await deployCommand({ config: configName, yes: opts.yes });
  } else {
    p.outro("Setup complete! Run `agent-army deploy` to deploy your agents.");
  }
}
