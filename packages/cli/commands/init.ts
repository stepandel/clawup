/**
 * clawup init — Interactive setup wizard
 *
 * Identity-driven: every agent must have an identity source.
 * The manifest stores only team composition (which agents to deploy).
 * Plugins, deps, and config come from identities at deploy time.
 */

import { execSync } from "child_process";
import * as p from "@clack/prompts";
import type { AgentDefinition, ClawupManifest, IdentityManifest } from "@clawup/core";
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
  PLUGIN_REGISTRY,
  DEP_REGISTRY,
} from "@clawup/core";
import { fetchIdentity } from "@clawup/core/identity";
import * as os from "os";
import * as path from "path";
import { checkPrerequisites } from "../lib/prerequisites";
import { selectOrCreateStack, setConfig, qualifiedStackName } from "../lib/pulumi";
import { saveManifest } from "../lib/config";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { showBanner, handleCancel, exitWithError, formatCost, formatAgentList } from "../lib/ui";

interface InitOptions {
  deploy?: boolean;
  yes?: boolean;
}

/** Fetched identity data stored alongside the agent definition */
interface FetchedIdentity {
  agent: AgentDefinition;
  manifest: IdentityManifest;
}

export async function initCommand(opts: InitOptions = {}): Promise<void> {
  showBanner();

  // -------------------------------------------------------------------------
  // Step 1: Check prerequisites
  // -------------------------------------------------------------------------
  p.log.step("Checking prerequisites...");
  const prereqsOk = await checkPrerequisites();
  if (!prereqsOk) {
    exitWithError("Prerequisites not met. Please install the missing tools and try again.");
  }
  p.log.success("All prerequisites satisfied!");

  // -------------------------------------------------------------------------
  // Step 2: Infrastructure config
  // -------------------------------------------------------------------------
  const stackName = await p.text({
    message: "Pulumi stack name",
    placeholder: "dev",
    defaultValue: "dev",
  });
  handleCancel(stackName);

  const organization = await p.text({
    message: "Pulumi organization (leave empty for personal account)",
    placeholder: "my-org",
    defaultValue: "",
  });
  handleCancel(organization);

  const provider = await p.select({
    message: "Cloud provider",
    options: PROVIDERS.map((prov) => ({ value: prov.value, label: prov.label, hint: prov.hint })),
    initialValue: "aws",
  });
  handleCancel(provider);

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

  // -------------------------------------------------------------------------
  // Step 3: Owner info
  // -------------------------------------------------------------------------
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

  const orgValue = (organization as string).trim() || undefined;

  const basicConfig = {
    stackName: stackName as string,
    organization: orgValue,
    provider: provider as "aws" | "hetzner",
    region,
    instanceType,
    ownerName: ownerName as string,
    timezone: timezone as string,
    workingHours: workingHours as string,
    userNotes: (userNotes as string) || "No additional notes provided yet.",
  };

  // -------------------------------------------------------------------------
  // Step 4: Secrets (Anthropic, Tailscale, Hetzner)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Step 5: Agent selection (identity-driven, no custom mode)
  // -------------------------------------------------------------------------
  p.log.step("Configure agents");

  const agentMode = await p.select({
    message: "How would you like to configure agents?",
    options: [
      { value: "built-in", label: "Built-in agents", hint: "PM (Juno), Eng (Titus), QA (Scout)" },
      { value: "identity", label: "From identity source", hint: "Load from a Git URL or local path" },
      { value: "mix", label: "Mix of both", hint: "Pick built-in + add from identity source" },
    ],
  });
  handleCancel(agentMode);

  const fetchedIdentities: FetchedIdentity[] = [];
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");

  // Collect built-in agents
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
      const agent: AgentDefinition = {
        name: `agent-${identity.manifest.name}`,
        displayName: identity.manifest.displayName,
        role: identity.manifest.role,
        identity: entry.path,
        volumeSize: identity.manifest.volumeSize,
      };
      fetchedIdentities.push({ agent, manifest: identity.manifest });
    }
  }

  // Collect identity-source agents
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

        const agent: AgentDefinition = {
          name: `agent-${identity.manifest.name}`,
          displayName: identity.manifest.displayName,
          role: identity.manifest.role,
          identity: identityUrl as string,
          volumeSize: parseInt(volumeOverride as string, 10),
        };
        fetchedIdentities.push({ agent, manifest: identity.manifest });
      } catch (err) {
        spinner.stop(`Failed to validate identity: ${(err as Error).message}`);
        p.log.error("Please check the URL and try again.");
        continue;
      }

      const more = await p.confirm({
        message: "Add another identity-based agent?",
        initialValue: false,
      });
      handleCancel(more);
      addMore = more as boolean;
    }
  }

  if (fetchedIdentities.length === 0) {
    exitWithError("No agents configured. At least one agent is required.");
  }

  const agents = fetchedIdentities.map((fi) => fi.agent);

  // -------------------------------------------------------------------------
  // Step 6: Collect template variable values
  // -------------------------------------------------------------------------

  // Auto-fillable vars from owner info
  const autoVars: Record<string, string> = {
    OWNER_NAME: basicConfig.ownerName,
    TIMEZONE: basicConfig.timezone,
    WORKING_HOURS: basicConfig.workingHours,
    USER_NOTES: basicConfig.userNotes,
  };

  // Scan all identities for template vars and deduplicate
  const allTemplateVarNames = new Set<string>();
  for (const fi of fetchedIdentities) {
    for (const v of fi.manifest.templateVars ?? []) {
      allTemplateVarNames.add(v);
    }
  }

  const templateVars: Record<string, string> = {};

  // Auto-fill known vars
  for (const varName of allTemplateVarNames) {
    if (autoVars[varName]) {
      templateVars[varName] = autoVars[varName];
    }
  }

  // Prompt for remaining vars
  const remainingVars = [...allTemplateVarNames].filter((v) => !templateVars[v]);
  if (remainingVars.length > 0) {
    p.log.step("Configure template variables");
    p.log.info(`Your agents use the following template variables: ${remainingVars.join(", ")}`);

    for (const varName of remainingVars) {
      const value = await p.text({
        message: `Value for ${varName}`,
        placeholder: varName === "LINEAR_TEAM" ? "e.g., ENG" : varName === "GITHUB_REPO" ? "https://github.com/org/repo" : "",
        validate: (val) => {
          if (!val.trim()) return `${varName} is required`;
        },
      });
      handleCancel(value);
      templateVars[varName] = value as string;
    }
  }

  // -------------------------------------------------------------------------
  // Step 7: Collect integration credentials (driven by identity plugins/deps)
  // -------------------------------------------------------------------------
  p.log.step("Configure integrations");

  // Determine which plugins and deps are needed across all identities
  const agentPlugins = new Map<string, Set<string>>(); // agent name → plugin names
  const agentDeps = new Map<string, Set<string>>(); // agent name → dep names
  const allPluginNames = new Set<string>();
  const allDepNames = new Set<string>();

  for (const fi of fetchedIdentities) {
    const plugins = new Set(fi.manifest.plugins ?? []);
    const deps = new Set(fi.manifest.deps ?? []);
    agentPlugins.set(fi.agent.name, plugins);
    agentDeps.set(fi.agent.name, deps);
    for (const pl of plugins) allPluginNames.add(pl);
    for (const d of deps) allDepNames.add(d);
  }

  // Track identity pluginDefaults per agent name for seeding plugin config files
  const identityPluginDefaults: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const fi of fetchedIdentities) {
    if (fi.manifest.pluginDefaults) {
      identityPluginDefaults[fi.agent.name] = fi.manifest.pluginDefaults;
    }
  }

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

  // Slack credentials — only if any identity has the slack plugin
  const slackCredentials: Record<string, { botToken: string; appToken: string }> = {};
  if (allPluginNames.has("slack")) {
    p.note(
      KEY_INSTRUCTIONS.slackCredentials.steps.join("\n"),
      KEY_INSTRUCTIONS.slackCredentials.title
    );

    for (const fi of fetchedIdentities) {
      if (!agentPlugins.get(fi.agent.name)?.has("slack")) continue;

      const slackManifest = slackAppManifest(fi.agent.displayName);
      try {
        execSync(
          process.platform === "darwin" ? "pbcopy" : "xclip -selection clipboard",
          { input: slackManifest },
        );
        p.log.success(`Slack manifest for ${fi.agent.displayName} copied to clipboard — paste it into Slack`);
      } catch {
        p.log.warn(`Could not copy to clipboard. Manifest for ${fi.agent.displayName}:`);
        console.log(slackManifest);
      }

      const botToken = await p.password({
        message: `Slack Bot Token for ${fi.agent.displayName} (${fi.agent.role})`,
        validate: (val) => {
          if (!val.startsWith("xoxb-")) return "Must start with xoxb-";
        },
      });
      handleCancel(botToken);

      const appToken = await p.password({
        message: `Slack App Token for ${fi.agent.displayName} (${fi.agent.role})`,
        validate: (val) => {
          if (!val.startsWith("xapp-")) return "Must start with xapp-";
        },
      });
      handleCancel(appToken);

      slackCredentials[fi.agent.role] = {
        botToken: botToken as string,
        appToken: appToken as string,
      };
    }
  }

  // Linear credentials — only if any identity has the openclaw-linear plugin
  if (allPluginNames.has("openclaw-linear")) {
    p.note(
      KEY_INSTRUCTIONS.linearApiKey.steps.join("\n"),
      KEY_INSTRUCTIONS.linearApiKey.title
    );

    const linearAgents = fetchedIdentities.filter(
      (fi) => agentPlugins.get(fi.agent.name)?.has("openclaw-linear")
    );

    for (const fi of linearAgents) {
      const linearKey = await p.password({
        message: `Linear API key for ${fi.agent.displayName} (${fi.agent.role})`,
        validate: (val) => {
          if (!val.startsWith("lin_api_")) return "Must start with lin_api_";
        },
      });
      handleCancel(linearKey);

      integrationCredentials[fi.agent.role].linearApiKey = linearKey as string;

      // Auto-fetch user UUID from Linear API
      const s = p.spinner();
      s.start(`Fetching Linear user ID for ${fi.agent.displayName}...`);
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
        integrationCredentials[fi.agent.role].linearUserUuid = uuid;
        s.stop(`${fi.agent.displayName}: ${uuid}`);
      } catch (err) {
        s.stop(`Could not fetch Linear user ID for ${fi.agent.displayName}`);
        p.log.warn(`${err instanceof Error ? err.message : String(err)}`);
        const linearUserUuid = await p.text({
          message: `Enter Linear user UUID manually for ${fi.agent.displayName}`,
          placeholder: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          validate: (val) => {
            if (!val) return "Linear user UUID is required";
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
              return "Must be a valid UUID format";
            }
          },
        });
        handleCancel(linearUserUuid);
        integrationCredentials[fi.agent.role].linearUserUuid = linearUserUuid as string;
      }
    }

    // Linear webhook signing secrets
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

    for (const fi of linearAgents) {
      const webhookUrl = `https://${tailscaleHostname(basicConfig.stackName, fi.agent.name)}.${tailnetDnsName as string}/hooks/linear`;

      p.log.info(`${fi.agent.displayName} (${fi.agent.role}): ${webhookUrl}`);

      const webhookSecretInput = await p.password({
        message: `Signing secret for ${fi.agent.displayName} (${fi.agent.role})`,
        validate: (val) => {
          if (!val) return "Webhook signing secret is required";
        },
      });
      handleCancel(webhookSecretInput);

      integrationCredentials[fi.agent.role].linearWebhookSecret = webhookSecretInput as string;
    }
  }

  // GitHub token — only if any identity has the gh dep
  if (allDepNames.has("gh")) {
    p.note(
      KEY_INSTRUCTIONS.githubToken.steps.join("\n"),
      KEY_INSTRUCTIONS.githubToken.title
    );

    for (const fi of fetchedIdentities) {
      if (!agentDeps.get(fi.agent.name)?.has("gh")) continue;

      const githubKey = await p.password({
        message: `GitHub token for ${fi.agent.displayName} (${fi.agent.role})`,
        validate: (val) => {
          if (!val.startsWith("ghp_") && !val.startsWith("github_pat_")) {
            return "Must start with ghp_ or github_pat_";
          }
        },
      });
      handleCancel(githubKey);

      integrationCredentials[fi.agent.role].githubToken = githubKey as string;
    }
  }

  // Brave Search API key — only if any identity has the brave-search dep (global, once)
  let braveApiKey: string | undefined;
  if (allDepNames.has("brave-search")) {
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

  // -------------------------------------------------------------------------
  // Step 8: Summary
  // -------------------------------------------------------------------------
  const costEstimates = basicConfig.provider === "aws" ? COST_ESTIMATES : HETZNER_COST_ESTIMATES;
  const costPerAgent = costEstimates[basicConfig.instanceType] ?? 30;
  const totalCost = agents.reduce((sum, a) => {
    const agentCost = costEstimates[a.instanceType ?? basicConfig.instanceType] ?? costPerAgent;
    return sum + agentCost;
  }, 0);

  const integrationNames: string[] = [];
  if (allPluginNames.has("openclaw-linear")) integrationNames.push("Linear");
  if (allPluginNames.has("slack")) integrationNames.push("Slack");
  if (allDepNames.has("gh")) integrationNames.push("GitHub CLI");
  if (allDepNames.has("brave-search")) integrationNames.push("Brave Search");

  const providerLabel = basicConfig.provider === "aws" ? "AWS" : "Hetzner";
  const regionLabel = basicConfig.provider === "aws" ? "Region" : "Location";

  // Build template vars display (excluding auto-filled owner vars)
  const customVarEntries = Object.entries(templateVars).filter(
    ([k]) => !autoVars[k]
  );

  const summaryLines = [
    `Stack:          ${basicConfig.stackName}`,
    `Provider:       ${providerLabel}`,
    `${regionLabel.padEnd(14, " ")} ${basicConfig.region}`,
    `Instance type:  ${basicConfig.instanceType}`,
    `Owner:          ${basicConfig.ownerName}`,
    `Timezone:       ${basicConfig.timezone}`,
    `Working hours:  ${basicConfig.workingHours}`,
  ];
  if (customVarEntries.length > 0) {
    for (const [k, v] of customVarEntries) {
      summaryLines.push(`${k.padEnd(14, " ")} ${v}`);
    }
  }
  if (integrationNames.length > 0) {
    summaryLines.push(`Integrations:   ${integrationNames.join(", ")}`);
  }
  summaryLines.push(
    ``,
    `Agents (${agents.length}):`,
    formatAgentList(agents),
    ``,
    `Estimated cost: ${formatCost(totalCost)}`
  );

  p.note(summaryLines.join("\n"), "Deployment Summary");

  // -------------------------------------------------------------------------
  // Step 9: Confirm
  // -------------------------------------------------------------------------
  const confirmed = await p.confirm({
    message: "Proceed with setup?",
  });
  handleCancel(confirmed);
  if (!confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Step 10: Execute setup
  // -------------------------------------------------------------------------
  const s = p.spinner();

  // Set up workspace
  s.start("Setting up workspace...");
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    s.stop("Failed to set up workspace");
    exitWithError(wsResult.error ?? "Failed to set up workspace.");
  }
  s.stop("Workspace ready");
  const cwd = getWorkspaceDir();

  // Select/create stack (use org-qualified name if organization is set)
  const pulumiStack = qualifiedStackName(basicConfig.stackName, basicConfig.organization);
  s.start("Selecting Pulumi stack...");
  const stackResult = selectOrCreateStack(pulumiStack, cwd);
  if (!stackResult.ok) {
    s.stop("Failed to select/create stack");
    if (stackResult.error) p.log.error(stackResult.error);
    exitWithError(`Could not select or create Pulumi stack "${pulumiStack}".`);
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
  setConfig("instanceType", basicConfig.instanceType, false, cwd);
  setConfig("ownerName", basicConfig.ownerName, false, cwd);
  setConfig("timezone", basicConfig.timezone, false, cwd);
  setConfig("workingHours", basicConfig.workingHours, false, cwd);
  setConfig("userNotes", basicConfig.userNotes, false, cwd);

  // Set per-agent integration credentials
  for (const [role, creds] of Object.entries(integrationCredentials)) {
    if (creds.linearApiKey) setConfig(`${role}LinearApiKey`, creds.linearApiKey, true, cwd);
    if (creds.linearWebhookSecret) setConfig(`${role}LinearWebhookSecret`, creds.linearWebhookSecret, true, cwd);
    if (creds.linearUserUuid) setConfig(`${role}LinearUserUuid`, creds.linearUserUuid, false, cwd);
    if (creds.githubToken) setConfig(`${role}GithubToken`, creds.githubToken, true, cwd);
  }
  // Set per-agent Slack credentials
  for (const [role, creds] of Object.entries(slackCredentials)) {
    setConfig(`${role}SlackBotToken`, creds.botToken, true, cwd);
    setConfig(`${role}SlackAppToken`, creds.appToken, true, cwd);
  }
  if (braveApiKey) setConfig("braveApiKey", braveApiKey, true, cwd);
  s.stop("Configuration saved");

  // Write manifest
  const configName = basicConfig.stackName;
  s.start(`Writing config to ~/.clawup/configs/${configName}.yaml...`);

  // Only include non-auto template vars in manifest (owner vars are derived at deploy time)
  const manifestTemplateVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(templateVars)) {
    if (!autoVars[k]) {
      manifestTemplateVars[k] = v;
    }
  }

  const manifest: ClawupManifest = {
    stackName: configName,
    organization: basicConfig.organization,
    provider: basicConfig.provider,
    region: basicConfig.region,
    instanceType: basicConfig.instanceType,
    ownerName: basicConfig.ownerName,
    timezone: basicConfig.timezone,
    workingHours: basicConfig.workingHours,
    userNotes: basicConfig.userNotes,
    templateVars: Object.keys(manifestTemplateVars).length > 0 ? manifestTemplateVars : undefined,
    agents,
  };
  // Inline plugin config into each agent definition
  for (const fi of fetchedIdentities) {
    const rolePlugins = agentPlugins.get(fi.agent.name);
    if (!rolePlugins || rolePlugins.size === 0) continue;

    const inlinePlugins: Record<string, Record<string, unknown>> = {};
    const defaults = identityPluginDefaults[fi.agent.name] ?? {};

    for (const pluginName of rolePlugins) {
      const pluginDefaults = defaults[pluginName] ?? {};
      const agentConfig: Record<string, unknown> = {
        ...pluginDefaults,
        agentId: fi.agent.name,
      };

      // Layer on user-provided config
      if (pluginName === "openclaw-linear") {
        const creds = integrationCredentials[fi.agent.role];
        if (creds?.linearUserUuid) {
          agentConfig.linearUserUuid = creds.linearUserUuid;
        }
      }

      inlinePlugins[pluginName] = agentConfig;
    }

    if (Object.keys(inlinePlugins).length > 0) {
      fi.agent.plugins = inlinePlugins;
    }
  }

  saveManifest(configName, manifest);
  s.stop("Config saved");

  if (opts.deploy) {
    p.log.success("Config saved! Starting deployment...\n");
    const { deployCommand } = await import("./deploy.js");
    await deployCommand({ config: configName, yes: opts.yes });
  } else {
    p.outro("Setup complete! Run `clawup deploy` to deploy your agents.");
  }
}
