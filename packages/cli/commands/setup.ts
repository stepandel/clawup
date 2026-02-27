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
import type { ClawupManifest, IdentityManifest, IdentityResult, ResolvedAgent } from "@clawup/core";
import {
  MANIFEST_FILE,
  ClawupManifestSchema,
  resolvePlugin,
  buildValidators,
  resolvePlugins,
  PLUGIN_MANIFEST_REGISTRY,
  getRequiredProviders,
  getProviderConfigKey,
} from "@clawup/core";
import { resolveAgentSync } from "@clawup/core/resolve";
import { resolvePluginSecrets, runLifecycleHook, runOnboardHook } from "@clawup/core/manifest-hooks";
import { fetchIdentity } from "@clawup/core/identity";
import { findProjectRoot } from "../lib/project";
import { selectOrCreateStack, setConfig, qualifiedStackName } from "../lib/pulumi";
import { ensureWorkspace, getWorkspaceDir } from "../lib/workspace";
import { showBanner, exitWithError } from "../lib/ui";
import {
  buildEnvDict,
  buildManifestSecrets,
  generateEnvExample,
  loadEnvSecrets,
  VALIDATORS,
} from "../lib/env";

interface SetupOptions {
  envFile?: string;
  deploy?: boolean;
  yes?: boolean;
  skipHooks?: boolean;
  skipOnboard?: boolean;
}

/** Fetched identity data stored alongside the resolved agent */
interface FetchedIdentity {
  agent: ResolvedAgent;
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

  // Resolve agent entries (hydrate name/displayName/role/volumeSize from identities)
  const resolvedAgents: ResolvedAgent[] = [];
  const identitySpinner = p.spinner();
  identitySpinner.start("Resolving agent identities...");
  for (const agent of agents) {
    try {
      const resolved = resolveAgentSync(agent, identityCacheDir);
      const identity = await fetchIdentity(agent.identity, identityCacheDir);
      resolvedAgents.push(resolved);
      fetchedIdentities.push({ agent: resolved, manifest: identity.manifest, identityResult: identity });
    } catch (err) {
      identitySpinner.stop(`Failed to resolve identity for ${agent.identity}`);
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

  // Collect all model strings across all agents (primary + backup)
  const allModels: string[] = [];
  for (const fi of fetchedIdentities) {
    const model = fi.manifest.model ?? "anthropic/claude-opus-4-6";
    allModels.push(model);
    if (fi.manifest.backupModel) {
      allModels.push(fi.manifest.backupModel);
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
    agents: resolvedAgents.map((a) => {
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
    allModels,
  });

  // Prune stale managed global keys, then merge fresh ones
  const existingGlobal = { ...(manifest.secrets ?? {}) };
  for (const key of expectedSecrets.managedGlobalKeys) {
    if (!(key in expectedSecrets.global)) {
      delete existingGlobal[key];
    }
  }
  const mergedGlobalSecrets = { ...existingGlobal, ...expectedSecrets.global };

  // Build per-agent secrets from identity data (not from manifest)
  const agentsWithSecrets = resolvedAgents.map((a) => ({
    name: a.name,
    secrets: expectedSecrets.perAgent[a.name],
  }));

  const resolvedSecrets = loadEnvSecrets(mergedGlobalSecrets, agentsWithSecrets, envDict);

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
          const agent = resolvedAgents.find((a) => a.name === agentName);
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
        ? ` — Agent: ${resolvedAgents.find((a) => a.name === m.agent)?.displayName ?? m.agent}`
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
  // 7b. Run onboard hooks (interactive first-time plugin setup)
  // -------------------------------------------------------------------------
  if (!opts.skipOnboard) {
    for (const fi of fetchedIdentities) {
      const plugins = agentPlugins.get(fi.agent.name);
      if (!plugins) continue;

      for (const pluginName of plugins) {
        const pluginManifest = resolvePlugin(pluginName, fi.identityResult);
        const onboard = pluginManifest.hooks?.onboard;
        if (!onboard) continue;

        // runOnce: skip if all required secrets are already present
        if (onboard.runOnce) {
          const roleUpper = fi.agent.role.toUpperCase();
          const allSecretsPresent = Object.entries(pluginManifest.secrets)
            .filter(([, s]) => s.required)
            .every(([key, secret]) => {
              // Check auto-resolved secrets (stored by raw plugin key)
              if (autoResolvedSecrets[fi.agent.role]?.[key]) return true;
              // Check env dict using the plugin secret's envVar (prefixed with role)
              const envKey = `${roleUpper}_${secret.envVar}`;
              return !!envDict[envKey];
            });
          if (allSecretsPresent) {
            p.log.info(`Onboard hook for ${pluginName} (${fi.agent.displayName}): skipped (already configured)`);
            continue;
          }
        }

        p.log.info(`Running onboard hook for ${pluginName} (${fi.agent.displayName}): ${onboard.description}`);

        // Collect inputs — from env or interactive prompt
        const hookEnv: Record<string, string> = {};

        // Add existing resolved secrets to hook env
        const agentSecrets = resolvedSecrets.perAgent[fi.agent.name] ?? {};
        for (const [, sec] of Object.entries(pluginManifest.secrets)) {
          const envDerivedKey = sec.envVar
            .toLowerCase()
            .split("_")
            .map((part: string, i: number) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
            .join("");
          if (agentSecrets[envDerivedKey]) {
            hookEnv[sec.envVar] = agentSecrets[envDerivedKey];
          }
        }

        for (const [inputKey, input] of Object.entries(onboard.inputs)) {
          // Check env first
          const envValue = envDict[input.envVar] ?? envDict[`${fi.agent.role.toUpperCase()}_${input.envVar}`];
          if (envValue) {
            hookEnv[input.envVar] = envValue;
            continue;
          }

          // Interactive prompt
          if (input.instructions) {
            p.log.info(input.instructions);
          }
          const value = await p.text({
            message: input.prompt,
            validate: (val) => {
              if (!val) return `${inputKey} is required`;
              if (input.validator && !val.startsWith(input.validator)) {
                return `${inputKey} must start with "${input.validator}"`;
              }
              return undefined;
            },
          });

          if (p.isCancel(value)) {
            exitWithError("Onboard cancelled by user.");
          }

          hookEnv[input.envVar] = value as string;
        }

        const result = await runOnboardHook({ script: onboard.script, env: hookEnv });
        if (result.ok) {
          if (result.instructions) {
            console.log();
            p.log.info(`Follow-up instructions for ${pluginName}:`);
            console.log(result.instructions);
            console.log();
          }
        } else {
          p.log.error(`Onboard hook for ${pluginName} failed: ${result.error}`);
          exitWithError(
            `Onboard hook failed. Fix the issue and run \`clawup setup\` again, or use --skip-onboard to bypass.`
          );
        }
      }
    }
  } else {
    p.log.warn("Onboard hooks skipped (--skip-onboard)");
  }

  // 8. Regenerate .env.example (no longer writes plugins/secrets back to manifest)
  // -------------------------------------------------------------------------
  const s = p.spinner();
  s.start("Updating .env.example...");

  // Build per-agent secrets for .env.example generation (from identity data)
  const perAgentSecrets = expectedSecrets.perAgent;
  const envExampleContent = generateEnvExample({
    globalSecrets: mergedGlobalSecrets,
    agents: resolvedAgents.map((a) => ({ name: a.name, displayName: a.displayName, role: a.role })),
    perAgentSecrets,
    agentPluginNames: agentPlugins,
  });
  fs.writeFileSync(path.join(projectRoot, ".env.example"), envExampleContent, "utf-8");
  s.stop(".env.example updated");

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
  // Set per-provider API keys — only store keys for providers actually used
  const requiredProviders = getRequiredProviders(allModels);
  for (const providerKey of requiredProviders) {
    const configKey = getProviderConfigKey(providerKey);
    const value = resolvedSecrets.global[configKey];
    if (value) {
      setConfig(configKey, value, true, cwd);
    }
  }
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
    const agent = resolvedAgents.find((a) => a.name === agentName);
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
