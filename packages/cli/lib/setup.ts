/**
 * Setup library — Reusable secret validation + Pulumi provisioning logic
 *
 * Extracted from commands/setup.ts so that both `clawup setup` (deprecated)
 * and `clawup deploy` can call it without duplicating logic.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
import { resolvePluginSecrets, runOnboardHook } from "@clawup/core/manifest-hooks";
import { fetchIdentity } from "@clawup/core/identity";
import { findProjectRoot } from "./project";
import { selectOrCreateStack, setConfig, qualifiedStackName } from "./pulumi";
import { ensureWorkspace, getWorkspaceDir } from "./workspace";
import {
  buildEnvDict,
  buildManifestSecrets,
  generateEnvExample,
  loadEnvSecrets,
  VALIDATORS,
} from "./env";
import { runOnboardHooks } from "./onboard-hooks";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Progress callbacks so callers can bridge to their own UI framework */
export interface SetupProgress {
  spinner: (msg: string) => { start: (msg: string) => void; stop: (msg: string) => void };
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    success: (msg: string) => void;
  };
  /** Prompt for text input (needed for onboard hooks) */
  text?: (opts: { message: string; validate?: (val: string) => string | undefined }) => Promise<string | symbol>;
  /** Check if a prompt result was cancelled */
  isCancel?: (val: unknown) => boolean;
}

export interface SetupOptions {
  envFile?: string;
  skipHooks?: boolean;
  /** Run plugin onboard hooks during setup */
  onboard?: boolean;
}

export interface SetupResult {
  ok: boolean;
  error?: string;
  /** The validated manifest (available when ok === true) */
  manifest?: ClawupManifest;
  /** Workspace directory where Pulumi config was written */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Fetched identity data stored alongside the resolved agent */
interface FetchedIdentity {
  agent: ResolvedAgent;
  manifest: IdentityManifest;
  identityResult: IdentityResult;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSetup(progress: SetupProgress, options?: SetupOptions): Promise<SetupResult> {
  // -------------------------------------------------------------------------
  // 1. Load manifest
  // -------------------------------------------------------------------------
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return { ok: false, error: `${MANIFEST_FILE} not found. Run \`clawup init\` first to create your project manifest.` };
  }

  const manifestPath = path.join(projectRoot, MANIFEST_FILE);
  let validation: ReturnType<typeof ClawupManifestSchema.safeParse>;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = YAML.parse(raw);
    validation = ClawupManifestSchema.safeParse(parsed);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read/parse ${MANIFEST_FILE} at ${manifestPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!validation.success) {
    const issues = validation.error.issues.map((i) => i.message).join(", ");
    return { ok: false, error: `Invalid ${MANIFEST_FILE} at ${manifestPath}: ${issues}` };
  }
  const manifest = validation.data;
  const agents = manifest.agents;

  progress.log.info(`Project: ${manifestPath}`);
  progress.log.info(
    `Stack: ${manifest.stackName} | Provider: ${manifest.provider} | ${agents.length} agent(s)`
  );

  // -------------------------------------------------------------------------
  // 2. Fetch identities
  // -------------------------------------------------------------------------
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const fetchedIdentities: FetchedIdentity[] = [];

  const resolvedAgents: ResolvedAgent[] = [];
  const identitySpinner = progress.spinner("Resolving agent identities...");
  identitySpinner.start("Resolving agent identities...");
  for (const agent of agents) {
    try {
      const resolved = resolveAgentSync(agent, identityCacheDir);
      const identity = await fetchIdentity(agent.identity, identityCacheDir);
      resolvedAgents.push(resolved);
      fetchedIdentities.push({ agent: resolved, manifest: identity.manifest, identityResult: identity });
    } catch (err) {
      identitySpinner.stop(`Failed to resolve identity for ${agent.identity}`);
      return {
        ok: false,
        error: `Failed to resolve identity "${agent.identity}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
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
    const lines = ["Missing template variables in clawup.yaml:"];
    for (const v of missingTemplateVars) lines.push(`  ${v}`);
    return {
      ok: false,
      error: lines.join("\n") + "\nAdd the missing template variables to the templateVars section of clawup.yaml.",
    };
  }

  // -------------------------------------------------------------------------
  // 4. Load .env
  // -------------------------------------------------------------------------
  const envFilePath = options?.envFile ?? path.join(projectRoot, ".env");
  if (!fs.existsSync(envFilePath)) {
    return {
      ok: false,
      error: `No .env found at ${envFilePath}.\nCopy .env.example to .env and fill in your secrets.`,
    };
  }
  const envDict = buildEnvDict(envFilePath);

  // -------------------------------------------------------------------------
  // 5. Resolve secrets
  // -------------------------------------------------------------------------
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

  // Build per-agent secrets from identity data
  const agentsWithSecrets = resolvedAgents.map((a) => ({
    name: a.name,
    secrets: expectedSecrets.perAgent[a.name],
  }));

  const resolvedSecrets = loadEnvSecrets(mergedGlobalSecrets, agentsWithSecrets, envDict);

  // -------------------------------------------------------------------------
  // 6. Validate completeness
  // -------------------------------------------------------------------------
  const missingSecrets = [...resolvedSecrets.missing];

  // Build merged validators
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
        progress.log.warn(`${key}: ${warning}`);
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
          progress.log.warn(`${key} (${agent?.displayName ?? agentName}): ${warning}`);
        }
      }
    }
  }

  // Filter out auto-resolvable secrets
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
    const lines = ["Missing secrets in .env:"];
    for (const m of requiredMissing) {
      const hint = getValidatorHint(m.key);
      const agentLabel = m.agent
        ? ` — Agent: ${resolvedAgents.find((a) => a.name === m.agent)?.displayName ?? m.agent}`
        : " — Required";
      lines.push(`  ${m.envVar.padEnd(30)}${agentLabel}${hint ? ` (${hint})` : ""}`);
    }
    return { ok: false, error: lines.join("\n") + "\nFill these in your .env file." };
  }

  progress.log.success("All secrets resolved");

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
          progress.log.success(`${key} for ${fi.agent.displayName} (from ${roleUpper}_${secret.envVar})`);
          if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
          autoResolvedSecrets[fi.agent.role][key] = envValue;
          continue;
        }
      }

      // Use manifest resolve hooks (if not skipped and hooks exist)
      if (!options?.skipHooks && pluginManifest.hooks?.resolve) {
        // Build env for resolve hooks
        const hookEnv: Record<string, string> = {};
        const agentSecrets = resolvedSecrets.perAgent[fi.agent.name] ?? {};
        for (const [k, v] of Object.entries(agentSecrets)) {
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

        const s = progress.spinner(`Resolving secrets for ${fi.agent.displayName} (${pluginName})...`);
        s.start(`Resolving secrets for ${fi.agent.displayName} (${pluginName})...`);
        const hookResult = await resolvePluginSecrets({ manifest: pluginManifest, env: hookEnv });
        if (hookResult.ok) {
          for (const [secretKey, secret] of Object.entries(pluginManifest.secrets)) {
            if (hookResult.values[secret.envVar]) {
              if (autoResolvedSecrets[fi.agent.role]?.[secretKey]) continue;
              if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
              autoResolvedSecrets[fi.agent.role][secretKey] = hookResult.values[secret.envVar];
            }
          }
          s.stop(`Resolved secrets for ${fi.agent.displayName} (${pluginName})`);
        } else {
          s.stop(`Failed to resolve secrets for ${fi.agent.displayName}`);
          const roleUpper = fi.agent.role.toUpperCase();
          return {
            ok: false,
            error:
              `${hookResult.error}\n` +
              `Set the required env vars in your .env file (prefixed with ${roleUpper}_) to bypass hook resolution.`,
          };
        }
      }
    }
  }

  if (options?.skipHooks) {
    progress.log.warn("Hooks skipped (--skip-hooks)");
  }

  // -------------------------------------------------------------------------
  // 7b. Run onboard hooks (interactive first-time plugin setup)
  // -------------------------------------------------------------------------
  if (progress.text && progress.isCancel) {
    let onboardError: string | undefined;
    await runOnboardHooks({
      fetchedIdentities,
      agentPlugins,
      resolvePlugin,
      autoResolvedSecrets,
      envDict,
      resolvedSecrets,
      p: {
        log: progress.log,
        spinner: () => {
          const s = progress.spinner("");
          return { start: (msg: string) => s.start(msg), stop: (msg?: string) => s.stop(msg ?? "") };
        },
        text: progress.text,
        isCancel: progress.isCancel,
      },
      runOnboardHook,
      exitWithError: (msg: string) => { onboardError = msg; throw new Error(msg); },
      skipOnboard: !options?.onboard,
    }).catch(() => {});
    if (onboardError) {
      return { ok: false, error: onboardError };
    }
  } else if (options?.onboard) {
    progress.log.warn("Onboard hooks require interactive prompts — skipping in this context.");
  }

  // -------------------------------------------------------------------------
  // 8. Regenerate .env.example
  // -------------------------------------------------------------------------
  const envSpinner = progress.spinner("Updating .env.example...");
  envSpinner.start("Updating .env.example...");

  const perAgentSecrets = expectedSecrets.perAgent;
  const envExampleContent = generateEnvExample({
    globalSecrets: mergedGlobalSecrets,
    agents: resolvedAgents.map((a) => ({ name: a.name, displayName: a.displayName, role: a.role })),
    perAgentSecrets,
    agentPluginNames: agentPlugins,
  });
  fs.writeFileSync(path.join(projectRoot, ".env.example"), envExampleContent, "utf-8");
  envSpinner.stop(".env.example updated");

  // -------------------------------------------------------------------------
  // 9. Provision Pulumi
  // -------------------------------------------------------------------------
  const wsSpinner = progress.spinner("Setting up workspace...");
  wsSpinner.start("Setting up workspace...");
  const wsResult = ensureWorkspace();
  if (!wsResult.ok) {
    wsSpinner.stop("Failed to set up workspace");
    return { ok: false, error: wsResult.error ?? "Failed to set up workspace." };
  }
  wsSpinner.stop("Workspace ready");
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
  const stackSpinner = progress.spinner("Selecting Pulumi stack...");
  stackSpinner.start("Selecting Pulumi stack...");
  const stackResult = selectOrCreateStack(pulumiStack, cwd, projectRoot);
  if (!stackResult.ok) {
    stackSpinner.stop("Failed to select/create stack");
    return { ok: false, error: stackResult.error ?? `Could not select or create Pulumi stack "${pulumiStack}".` };
  }
  stackSpinner.stop("Pulumi stack ready");

  // Set Pulumi config
  const configSpinner = progress.spinner("Setting Pulumi configuration...");
  configSpinner.start("Setting Pulumi configuration...");
  setConfig("provider", manifest.provider, false, cwd);
  if (manifest.provider === "aws") {
    setConfig("aws:region", manifest.region, false, cwd);
  } else if (manifest.provider === "hetzner") {
    setConfig("hetzner:location", manifest.region, false, cwd);
    if (resolvedSecrets.global.hcloudToken) {
      setConfig("hcloud:token", resolvedSecrets.global.hcloudToken, true, cwd);
    }
  }
  const modelProvider = manifest.modelProvider ?? "anthropic";
  setConfig("modelProvider", modelProvider, false, cwd);
  if (manifest.defaultModel) {
    setConfig("defaultModel", manifest.defaultModel, false, cwd);
  }
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
      const isSecret = resolveIsSecret(key, agentManifests);
      setConfig(configKey, value, isSecret, cwd);
    }
  }

  // Set auto-resolved secrets
  for (const [role, resolved] of Object.entries(autoResolvedSecrets)) {
    const fi = fetchedIdentities.find((f) => f.agent.role === role);
    const agentManifests = fi
      ? resolvePlugins([...(agentPlugins.get(fi.agent.name) ?? [])], fi.identityResult)
      : [];

    for (const [key, value] of Object.entries(resolved)) {
      const configKey = `${role}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      const isSecret = resolveIsSecret(key, agentManifests);
      setConfig(configKey, value, isSecret, cwd);
    }
  }

  if (resolvedSecrets.global.braveApiKey) {
    setConfig("braveApiKey", resolvedSecrets.global.braveApiKey, true, cwd);
  }
  configSpinner.stop("Configuration saved");

  return { ok: true, manifest, cwd };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a secret key should be stored as a Pulumi secret.
 * Resolves by checking the agent's plugin manifests for matching secret metadata.
 * Falls back to true (encrypted) if no metadata found.
 */
function resolveIsSecret(key: string, agentManifests: Array<{ secrets: Record<string, { envVar: string; isSecret: boolean }> }>): boolean {
  for (const pm of agentManifests) {
    if (pm.secrets[key] !== undefined) {
      return pm.secrets[key].isSecret;
    }
    for (const secret of Object.values(pm.secrets)) {
      const envDerivedKey = secret.envVar
        .toLowerCase()
        .split("_")
        .map((part: string, i: number) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
      if (envDerivedKey === key) return secret.isSecret;
    }
  }
  return true;
}

/** Get a human-readable hint for a validator */
function getValidatorHint(key: string): string {
  const infraHints: Record<string, string> = {
    anthropicApiKey: "must start with sk-ant-",
    openaiApiKey: "must start with sk-",
    openrouterApiKey: "must start with sk-or-",
    tailscaleAuthKey: "must start with tskey-auth-",
    tailnetDnsName: "must end with .ts.net",
    githubToken: "must start with ghp_ or github_pat_",
  };
  if (infraHints[key]) return infraHints[key];

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
