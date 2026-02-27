/**
 * clawup setup — Non-interactive secret validation + Pulumi provisioning
 *
 * Reads clawup.yaml + .env, validates all secrets are present,
 * fetches identities, does Linear UUID lookup, sets Pulumi config.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as p from "@clack/prompts";
import YAML from "yaml";
import type { AgentDefinition, ClawupManifest, IdentityManifest, IdentityResult } from "@clawup/core";
import {
  MANIFEST_FILE,
  ClawupManifestSchema,
  tailscaleHostname,
  resolvePlugin,
  buildValidators,
  isSecretCoveredByPlugin,
  resolvePlugins,
  PLUGIN_MANIFEST_REGISTRY,
  MODEL_PROVIDERS,
  getProviderForModel,
} from "@clawup/core";
import { resolvePluginSecrets, runLifecycleHook } from "@clawup/core/manifest-hooks";
import { fetchIdentity } from "@clawup/core/identity";
import { findProjectRoot } from "../lib/project";
import { selectOrCreateStack, setConfig, qualifiedStackName } from "../lib/pulumi";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { showBanner, exitWithError } from "../lib/ui";
import {
  buildEnvDict,
  buildManifestSecrets,
  camelToScreamingSnake,
  generateEnvExample,
  loadEnvSecrets,
  VALIDATORS,
  agentEnvVarName,
} from "../lib/env";

interface SetupOptions {
  envFile?: string;
  deploy?: boolean;
  yes?: boolean;
  skipHooks?: boolean;
}

/** Fetched identity data stored alongside the agent definition */
interface FetchedIdentity {
  agent: AgentDefinition;
  manifest: IdentityManifest;
  identityResult: IdentityResult;
}

export async function setupCommand(opts: SetupOptions = {}): Promise<void> {
  showBanner();

  // -------------------------------------------------------------------------
  // 1. Load manifest
  // -------------------------------------------------------------------------
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    exitWithError(
      `${MANIFEST_FILE} not found. Run \`clawup init\` first to create your project manifest.`
    );
  }

  const manifestPath = path.join(projectRoot, MANIFEST_FILE);
  let validation: ReturnType<typeof ClawupManifestSchema.safeParse>;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = YAML.parse(raw);
    validation = ClawupManifestSchema.safeParse(parsed);
  } catch (err) {
    exitWithError(
      `Failed to read/parse ${MANIFEST_FILE} at ${manifestPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }
  if (!validation.success) {
    const issues = validation.error.issues.map((i) => i.message).join(", ");
    exitWithError(`Invalid ${MANIFEST_FILE} at ${manifestPath}: ${issues}`);
    return;
  }
  const manifest = validation.data;
  const agents = manifest.agents;

  p.log.info(`Project: ${manifestPath}`);
  p.log.info(
    `Stack: ${manifest.stackName} | Provider: ${manifest.provider} | ${agents.length} agent(s)`
  );

  // -------------------------------------------------------------------------
  // 2. Fetch identities
  // -------------------------------------------------------------------------
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const fetchedIdentities: FetchedIdentity[] = [];

  const identitySpinner = p.spinner();
  identitySpinner.start("Resolving agent identities...");
  for (const agent of agents) {
    try {
      const identity = await fetchIdentity(agent.identity, identityCacheDir);
      fetchedIdentities.push({ agent, manifest: identity.manifest, identityResult: identity });
    } catch (err) {
      identitySpinner.stop(`Failed to resolve identity for ${agent.name}`);
      exitWithError(
        `Failed to resolve identity "${agent.identity}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return;
    }
  }
  identitySpinner.stop(
    `Resolved ${fetchedIdentities.length} agent identit${fetchedIdentities.length === 1 ? "y" : "ies"}`
  );

  // Build plugin/dep maps
  const agentPlugins = new Map<string, Set<string>>();
  const agentDeps = new Map<string, Set<string>>();
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

  const identityPluginDefaults: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const fi of fetchedIdentities) {
    if (fi.manifest.pluginDefaults) {
      identityPluginDefaults[fi.agent.name] = fi.manifest.pluginDefaults;
    }
  }

  // Collect requiredSecrets from identities
  const agentRequiredSecrets: Record<string, string[]> = {};
  for (const fi of fetchedIdentities) {
    if (fi.manifest.requiredSecrets && fi.manifest.requiredSecrets.length > 0) {
      agentRequiredSecrets[fi.agent.name] = fi.manifest.requiredSecrets;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Resolve template vars
  // -------------------------------------------------------------------------
  const allTemplateVarNames = new Set<string>();
  for (const fi of fetchedIdentities) {
    for (const v of fi.manifest.templateVars ?? []) {
      allTemplateVarNames.add(v);
    }
  }

  // Auto-fillable vars from manifest owner info
  const autoVars: Record<string, string> = {};
  if (manifest.ownerName) autoVars.OWNER_NAME = manifest.ownerName;
  if (manifest.timezone) autoVars.TIMEZONE = manifest.timezone;
  if (manifest.workingHours) autoVars.WORKING_HOURS = manifest.workingHours;
  if (manifest.userNotes) autoVars.USER_NOTES = manifest.userNotes;

  const templateVars: Record<string, string> = { ...(manifest.templateVars ?? {}) };
  for (const varName of allTemplateVarNames) {
    if (!templateVars[varName] && autoVars[varName]) {
      templateVars[varName] = autoVars[varName];
    }
  }

  const missingTemplateVars = [...allTemplateVarNames].filter((v) => !templateVars[v]);
  if (missingTemplateVars.length > 0) {
    p.log.error("Missing template variables in clawup.yaml:");
    for (const v of missingTemplateVars) {
      p.log.error(`  ${v}`);
    }
    exitWithError(
      "Add the missing template variables to the templateVars section of clawup.yaml, then run `clawup setup` again."
    );
  }

  // -------------------------------------------------------------------------
  // 4. Load .env
  // -------------------------------------------------------------------------
  const envFilePath = opts.envFile ?? path.join(projectRoot, ".env");
  if (!fs.existsSync(envFilePath)) {
    exitWithError(
      `No .env found at ${envFilePath}.\nCopy .env.example to .env and fill in your secrets, then run \`clawup setup\` again.`
    );
  }
  const envDict = buildEnvDict(envFilePath);

  // -------------------------------------------------------------------------
  // 5. Resolve secrets — rebuild manifest secrets from identity data
  // -------------------------------------------------------------------------
  // Rebuild the full secrets map from identity data to catch any new
  // requiredSecrets that may not be in the manifest yet
  const expectedSecrets = buildManifestSecrets({
    provider: manifest.provider,
    agents: agents.map((a) => {
      const fi = fetchedIdentities.find((f) => f.agent.name === a.name);
      return {
        name: a.name,
        role: a.role,
        displayName: a.displayName,
        requiredSecrets: fi?.manifest.requiredSecrets,
      };
    }),
    allPluginNames,
    allDepNames,
    agentPlugins,
    agentDeps,
  });

  // Merge expected secrets into manifest (add any missing env refs)
  const mergedGlobalSecrets = { ...(manifest.secrets ?? {}), ...expectedSecrets.global };
  for (const agent of agents) {
    const expected = expectedSecrets.perAgent[agent.name];
    if (expected) {
      agent.secrets = { ...(agent.secrets ?? {}), ...expected };
    }
  }

  const resolvedSecrets = loadEnvSecrets(mergedGlobalSecrets, agents, envDict);

  // -------------------------------------------------------------------------
  // 6. Validate completeness
  // -------------------------------------------------------------------------
  const missingSecrets = [...resolvedSecrets.missing];

  // Build merged validators: infrastructure + plugin-derived (from full resolved manifests)
  const allResolvedManifests = [...allPluginNames].map((name) => {
    const fi = fetchedIdentities.find((f) => agentPlugins.get(f.agent.name)?.has(name));
    return resolvePlugin(name, fi?.identityResult);
  });
  const pluginValidators = buildValidators(allResolvedManifests);
  const allValidators = { ...VALIDATORS, ...pluginValidators };

  // Run validators on resolved values (warn, don't block)
  for (const [key, value] of Object.entries(resolvedSecrets.global)) {
    const validator = allValidators[key];
    if (validator) {
      const warning = validator(value);
      if (warning) {
        p.log.warn(`${key}: ${warning}`);
      }
    }
  }
  for (const [agentName, agentSecrets] of Object.entries(resolvedSecrets.perAgent)) {
    for (const [key, value] of Object.entries(agentSecrets)) {
      const validator = allValidators[key];
      if (validator) {
        const warning = validator(value);
        if (warning) {
          const agent = agents.find((a) => a.name === agentName);
          p.log.warn(`${key} (${agent?.displayName ?? agentName}): ${warning}`);
        }
      }
    }
  }

  // Filter out auto-resolvable secrets (e.g., linearUserUuid) — don't require them in .env
  // Use agent-specific resolved manifests for context-aware lookup
  const requiredMissing = missingSecrets.filter((m) => {
    const agentManifests = m.agent
      ? (() => {
          const fi = fetchedIdentities.find((f) => f.agent.name === m.agent);
          return fi ? resolvePlugins([...(agentPlugins.get(m.agent) ?? [])], fi.identityResult) : allResolvedManifests;
        })()
      : allResolvedManifests;
    for (const pm of agentManifests) {
      if (pm.secrets[m.key]?.autoResolvable) return false;
    }
    return true;
  });

  if (requiredMissing.length > 0) {
    console.log();
    p.log.error("Missing secrets in .env:");
    for (const m of requiredMissing) {
      const hint = getValidatorHint(m.key);
      const agentLabel = m.agent
        ? ` — Agent: ${agents.find((a) => a.name === m.agent)?.displayName ?? m.agent}`
        : " — Required";
      p.log.error(`  ${m.envVar.padEnd(30)}${agentLabel}${hint ? ` (${hint})` : ""}`);
    }
    console.log();
    exitWithError("Fill these in your .env file, then run `clawup setup` again.");
  }

  p.log.success("All secrets resolved");

  // -------------------------------------------------------------------------
  // 7. Auto-resolve secrets (via manifest hooks or env overrides)
  // -------------------------------------------------------------------------
  const autoResolvedSecrets: Record<string, Record<string, string>> = {};

  for (const fi of fetchedIdentities) {
    const plugins = agentPlugins.get(fi.agent.name);
    if (!plugins) continue;

    for (const pluginName of plugins) {
      const pluginManifest = resolvePlugin(pluginName, fi.identityResult);
      for (const [key, secret] of Object.entries(pluginManifest.secrets)) {
        if (!secret.autoResolvable) continue;

        const roleUpper = fi.agent.role.toUpperCase();

        // Check if already in manifest plugin config
        const existingPluginConfig = fi.agent.plugins?.[pluginName] as Record<string, unknown> | undefined;
        if (existingPluginConfig?.[key]) {
          if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
          autoResolvedSecrets[fi.agent.role][key] = existingPluginConfig[key] as string;
          continue;
        }

        // Check if set as env var
        const envValue = envDict[`${roleUpper}_${secret.envVar}`];
        if (envValue) {
          p.log.success(`${key} for ${fi.agent.displayName} (from ${roleUpper}_${secret.envVar})`);
          if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
          autoResolvedSecrets[fi.agent.role][key] = envValue;
          continue;
        }
      }

      // Use manifest resolve hooks (if not skipped and hooks exist)
      if (!opts.skipHooks && pluginManifest.hooks?.resolve) {
        // Build env for resolve hooks — include resolved secrets for this agent
        const hookEnv: Record<string, string> = {};
        const agentSecrets = resolvedSecrets.perAgent[fi.agent.name] ?? {};
        for (const [k, v] of Object.entries(agentSecrets)) {
          // Map camelCase key back to env var using plugin secret definitions
          for (const [, sec] of Object.entries(pluginManifest.secrets)) {
            const envDerivedKey = sec.envVar
              .toLowerCase()
              .split("_")
              .map((part: string, i: number) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
              .join("");
            if (envDerivedKey === k) {
              hookEnv[sec.envVar] = v;
            }
          }
        }

        const s = p.spinner();
        s.start(`Resolving secrets for ${fi.agent.displayName} (${pluginName})...`);
        const hookResult = await resolvePluginSecrets({ manifest: pluginManifest, env: hookEnv });
        if (hookResult.ok) {
          // Map resolved env vars back to secret keys
          for (const [secretKey, secret] of Object.entries(pluginManifest.secrets)) {
            if (hookResult.values[secret.envVar]) {
              // Skip if already resolved above
              if (autoResolvedSecrets[fi.agent.role]?.[secretKey]) continue;
              if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
              autoResolvedSecrets[fi.agent.role][secretKey] = hookResult.values[secret.envVar];
            }
          }
          s.stop(`Resolved secrets for ${fi.agent.displayName} (${pluginName})`);
        } else {
          s.stop(`Failed to resolve secrets for ${fi.agent.displayName}`);
          const roleUpper = fi.agent.role.toUpperCase();
          exitWithError(
            `${hookResult.error}\n` +
            `Set the required env vars in your .env file (prefixed with ${roleUpper}_) to bypass hook resolution, then run \`clawup setup\` again.`
          );
        }
      }
    }
  }

  if (opts.skipHooks) {
    p.log.warn("Hooks skipped (--skip-hooks)");
  }

  // -------------------------------------------------------------------------
  // 8. Update manifest
  // -------------------------------------------------------------------------
  const s = p.spinner();
  s.start("Updating manifest...");

  // Update manifest secrets section
  manifest.secrets = mergedGlobalSecrets;

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

      // Inject auto-resolved secrets for this plugin
      const roleAutoResolved = autoResolvedSecrets[fi.agent.role];
      if (roleAutoResolved) {
        const manifest = resolvePlugin(pluginName, fi.identityResult);
        for (const [key, secret] of Object.entries(manifest.secrets)) {
          if (secret.autoResolvable && roleAutoResolved[key]) {
            agentConfig[key] = roleAutoResolved[key];
          }
        }
      }

      inlinePlugins[pluginName] = agentConfig;
    }

    if (Object.keys(inlinePlugins).length > 0) {
      fi.agent.plugins = inlinePlugins;
    }
  }

  // Add requiredSecrets-derived env refs to per-agent secrets in manifest
  for (const fi of fetchedIdentities) {
    if (!fi.manifest.requiredSecrets || fi.manifest.requiredSecrets.length === 0) continue;

    const plugins = agentPlugins.get(fi.agent.name);
    const deps = agentDeps.get(fi.agent.name);
    const roleUpper = fi.agent.role.toUpperCase();

    if (!fi.agent.secrets) fi.agent.secrets = {};

    // Resolve plugins for this agent to check coverage generically
    const agentResolvedPlugins = resolvePlugins([...(plugins ?? [])], fi.identityResult);

    for (const key of fi.manifest.requiredSecrets) {
      if (fi.agent.secrets[key]) continue;
      // Check if this secret is already covered by a plugin's secrets definition
      const coveredByPlugin = isSecretCoveredByPlugin(key, agentResolvedPlugins);
      const coveredByDep = key === "githubToken" && deps?.has("gh");
      if (coveredByPlugin || coveredByDep) continue;
      fi.agent.secrets[key] = `\${env:${roleUpper}_${camelToScreamingSnake(key)}}`;
    }
  }

  // Write updated manifest
  fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");

  // Regenerate .env.example
  const perAgentSecrets: Record<string, Record<string, string>> = {};
  for (const agent of agents) {
    if (agent.secrets) perAgentSecrets[agent.name] = agent.secrets;
  }
  const envExampleContent = generateEnvExample({
    globalSecrets: manifest.secrets,
    agents: agents.map((a) => ({ name: a.name, displayName: a.displayName, role: a.role })),
    perAgentSecrets,
    agentPluginNames: agentPlugins,
  });
  fs.writeFileSync(path.join(projectRoot, ".env.example"), envExampleContent, "utf-8");
  s.stop("Manifest updated");

  // -------------------------------------------------------------------------
  // 9. Provision Pulumi
  // -------------------------------------------------------------------------
  s.start("Setting up workspace...");
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    s.stop("Failed to set up workspace");
    exitWithError(wsResult.error ?? "Failed to set up workspace.");
  }
  s.stop("Workspace ready");
  const cwd = getWorkspaceDir();

  // Ensure .clawup/ and .env are in .gitignore
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const ignoreEntries = [".clawup/", ".env"];
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    const toAdd = ignoreEntries.filter((entry) => !existing.includes(entry));
    if (toAdd.length > 0) {
      fs.appendFileSync(gitignorePath, `\n# clawup local state\n${toAdd.join("\n")}\n`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `# clawup local state\n${ignoreEntries.join("\n")}\n`, "utf-8");
  }

  // Select/create stack
  const pulumiStack = qualifiedStackName(manifest.stackName, manifest.organization);
  s.start("Selecting Pulumi stack...");
  const stackResult = selectOrCreateStack(pulumiStack, cwd, projectRoot);
  if (!stackResult.ok) {
    s.stop("Failed to select/create stack");
    if (stackResult.error) p.log.error(stackResult.error);
    exitWithError(`Could not select or create Pulumi stack "${pulumiStack}".`);
  }
  s.stop("Pulumi stack ready");

  // Set Pulumi config
  s.start("Setting Pulumi configuration...");
  setConfig("provider", manifest.provider, false, cwd);
  if (manifest.provider === "aws") {
    setConfig("aws:region", manifest.region, false, cwd);
  } else if (manifest.provider === "hetzner") {
    setConfig("hetzner:location", manifest.region, false, cwd);
    if (resolvedSecrets.global.hcloudToken) {
      setConfig("hcloud:token", resolvedSecrets.global.hcloudToken, true, cwd);
    }
  }
  // Local provider doesn't need region/cloud config
  const modelProvider = manifest.modelProvider ?? "anthropic";
  setConfig("modelProvider", modelProvider, false, cwd);
  if (manifest.defaultModel) {
    setConfig("defaultModel", manifest.defaultModel, false, cwd);
  }
  // Set the model provider API key (stored as "anthropicApiKey" in Pulumi for backward compat)
  const providerDef = MODEL_PROVIDERS[modelProvider as keyof typeof MODEL_PROVIDERS];
  const providerApiKeyName = providerDef?.envVar
    ? providerDef.envVar.toLowerCase().split("_").map((p: string, i: number) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join("")
    : "anthropicApiKey";
  setConfig("anthropicApiKey", resolvedSecrets.global[providerApiKeyName] ?? resolvedSecrets.global.anthropicApiKey, true, cwd);
  if (manifest.provider !== "local") {
    setConfig("tailscaleAuthKey", resolvedSecrets.global.tailscaleAuthKey, true, cwd);
    setConfig("tailnetDnsName", resolvedSecrets.global.tailnetDnsName, false, cwd);
    if (resolvedSecrets.global.tailscaleApiKey) {
      setConfig("tailscaleApiKey", resolvedSecrets.global.tailscaleApiKey, true, cwd);
    }
  }
  setConfig("instanceType", manifest.instanceType, false, cwd);
  setConfig("ownerName", manifest.ownerName, false, cwd);
  if (manifest.timezone) setConfig("timezone", manifest.timezone, false, cwd);
  if (manifest.workingHours) setConfig("workingHours", manifest.workingHours, false, cwd);
  if (manifest.userNotes) setConfig("userNotes", manifest.userNotes, false, cwd);

  // Set per-agent secrets
  for (const [agentName, agentSecrets] of Object.entries(resolvedSecrets.perAgent)) {
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) continue;
    const role = agent.role;
    const fi = fetchedIdentities.find((f) => f.agent.name === agentName);
    const agentManifests = fi
      ? resolvePlugins([...(agentPlugins.get(agentName) ?? [])], fi.identityResult)
      : [];

    for (const [key, value] of Object.entries(agentSecrets)) {
      const configKey = `${role}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      // Determine isSecret from the agent's resolved plugin manifests
      const isSecret = resolveIsSecret(key, agentManifests);
      setConfig(configKey, value, isSecret, cwd);
    }
  }

  // Set auto-resolved secrets (e.g., Linear user UUIDs)
  for (const [role, resolved] of Object.entries(autoResolvedSecrets)) {
    const fi = fetchedIdentities.find((f) => f.agent.role === role);
    const agentManifests = fi
      ? resolvePlugins([...(agentPlugins.get(fi.agent.name) ?? [])], fi.identityResult)
      : [];

    for (const [key, value] of Object.entries(resolved)) {
      const configKey = `${role}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      // Determine isSecret from the agent's resolved plugin manifests
      const isSecret = resolveIsSecret(key, agentManifests);
      setConfig(configKey, value, isSecret, cwd);
    }
  }

  if (resolvedSecrets.global.braveApiKey) {
    setConfig("braveApiKey", resolvedSecrets.global.braveApiKey, true, cwd);
  }
  s.stop("Configuration saved");

  // -------------------------------------------------------------------------
  // 10. Optional deploy
  // -------------------------------------------------------------------------
  if (opts.deploy) {
    p.log.success("Setup complete! Starting deployment...\n");
    const { deployCommand } = await import("./deploy.js");
    await deployCommand({ yes: opts.yes });
  } else {
    p.outro("Setup complete! Run `clawup deploy` to deploy your agents.");
  }
}

/**
 * Determine if a secret key should be stored as a Pulumi secret.
 * Resolves by checking the agent's plugin manifests for matching secret metadata.
 * Falls back to true (encrypted) if no metadata found.
 */
function resolveIsSecret(key: string, agentManifests: Array<{ secrets: Record<string, { envVar: string; isSecret: boolean }> }>): boolean {
  for (const pm of agentManifests) {
    // Check by raw key first (e.g., "linearUserUuid")
    if (pm.secrets[key] !== undefined) {
      return pm.secrets[key].isSecret;
    }
    // Check by envVar-derived camelCase key (e.g., "linearApiKey" matches LINEAR_API_KEY)
    for (const secret of Object.values(pm.secrets)) {
      const envDerivedKey = secret.envVar
        .toLowerCase()
        .split("_")
        .map((part: string, i: number) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
      if (envDerivedKey === key) return secret.isSecret;
    }
  }
  return true; // default to encrypted
}

/** Get a human-readable hint for a validator */
function getValidatorHint(key: string): string {
  // Infrastructure hints
  const infraHints: Record<string, string> = {
    anthropicApiKey: "must start with sk-ant-",
    openaiApiKey: "must start with sk-",
    openrouterApiKey: "must start with sk-or-",
    tailscaleAuthKey: "must start with tskey-auth-",
    tailnetDnsName: "must end with .ts.net",
    githubToken: "must start with ghp_ or github_pat_",
  };
  if (infraHints[key]) return infraHints[key];

  // Plugin-derived hints (from validator prefix) — check both raw key and envVar-derived key
  for (const pm of Object.values(PLUGIN_MANIFEST_REGISTRY)) {
    if (pm.secrets[key]?.validator) {
      return `must start with ${pm.secrets[key].validator}`;
    }
    for (const secret of Object.values(pm.secrets)) {
      const envDerivedKey = secret.envVar
        .toLowerCase()
        .split("_")
        .map((part: string, i: number) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
      if (envDerivedKey === key && secret.validator) {
        return `must start with ${secret.validator}`;
      }
    }
  }

  return "";
}
