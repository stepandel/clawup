/**
 * clawup onboard — Standalone plugin onboard hook runner
 *
 * Bootstraps the minimum context needed (manifest, identities, plugin maps,
 * .env, secrets) and runs onboard hooks interactively.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as p from "@clack/prompts";
import YAML from "yaml";
import type { IdentityResult, ResolvedAgent } from "@clawup/core";
import {
  MANIFEST_FILE,
  ClawupManifestSchema,
  resolvePlugin,
  resolvePlugins,
} from "@clawup/core";
import { resolveAgentSync } from "@clawup/core/resolve";
import { runOnboardHook } from "@clawup/core/manifest-hooks";
import { fetchIdentity } from "@clawup/core/identity";
import { findProjectRoot } from "../lib/project";
import { showBanner, exitWithError } from "../lib/ui";
import { runOnboardHooks } from "../lib/onboard-hooks";
import { buildEnvDict, buildManifestSecrets, loadEnvSecrets } from "../lib/env";

interface OnboardOptions {
  envFile?: string;
}

export async function onboardCommand(opts: OnboardOptions = {}): Promise<void> {
  showBanner();

  // 1. Load manifest
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
  const rawAgents = manifest.agents;

  p.log.info(`Project: ${manifestPath}`);

  // 2. Fetch identities
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const fetchedIdentities: Array<{
    agent: { name: string; role: string; displayName: string };
    identityResult: IdentityResult;
  }> = [];

  const identitySpinner = p.spinner();
  identitySpinner.start("Resolving agent identities...");
  const resolvedAgents: ResolvedAgent[] = [];
  for (const agent of rawAgents) {
    try {
      const identity = await fetchIdentity(agent.identity, identityCacheDir);
      const resolved = resolveAgentSync(agent, identityCacheDir);
      resolvedAgents.push(resolved);
      fetchedIdentities.push({ agent: resolved, identityResult: identity });
    } catch (err) {
      identitySpinner.stop(`Failed to resolve identity for ${agent.name ?? agent.identity}`);
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

  // 3. Build plugin maps
  const agentPlugins = new Map<string, Set<string>>();
  const allPluginNames = new Set<string>();
  const allDepNames = new Set<string>();

  for (const fi of fetchedIdentities) {
    const identityManifest = fi.identityResult.manifest;
    const plugins = new Set(identityManifest.plugins ?? []);
    agentPlugins.set(fi.agent.name, plugins);
    for (const pl of plugins) allPluginNames.add(pl);
    for (const d of identityManifest.deps ?? []) allDepNames.add(d);
  }

  // 4. Load .env
  const envFilePath = opts.envFile ?? path.join(projectRoot, ".env");
  if (!fs.existsSync(envFilePath)) {
    exitWithError(
      `No .env found at ${envFilePath}.\nCopy .env.example to .env and fill in your secrets, then run \`clawup onboard\` again.`
    );
  }
  const envDict = buildEnvDict(envFilePath);

  // 5. Resolve secrets
  const agentDeps = new Map<string, Set<string>>();
  const allModels: string[] = [];
  for (const fi of fetchedIdentities) {
    const identityManifest = fi.identityResult.manifest;
    agentDeps.set(fi.agent.name, new Set(identityManifest.deps ?? []));
    allModels.push(identityManifest.model ?? "anthropic/claude-opus-4-6");
    if (identityManifest.backupModel) allModels.push(identityManifest.backupModel);
  }

  const expectedSecrets = buildManifestSecrets({
    provider: manifest.provider,
    agents: resolvedAgents.map((a) => {
      const fi = fetchedIdentities.find((f) => f.agent.name === a.name);
      return {
        name: a.name,
        role: a.role,
        displayName: a.displayName,
        requiredSecrets: fi?.identityResult.manifest.requiredSecrets ?? [],
      };
    }),
    allPluginNames,
    allDepNames,
    agentPlugins,
    agentDeps,
    allModels,
  });

  const mergedGlobalSecrets = { ...(manifest.secrets ?? {}), ...expectedSecrets.global };
  for (const agent of resolvedAgents) {
    const expected = expectedSecrets.perAgent[agent.name];
    if (expected) {
      agent.secrets = { ...(agent.secrets ?? {}), ...expected };
    }
  }

  const resolvedSecrets = loadEnvSecrets(mergedGlobalSecrets, resolvedAgents, envDict);

  // 7. Build auto-resolved secrets
  const autoResolvedSecrets: Record<string, Record<string, string>> = {};

  for (const fi of fetchedIdentities) {
    const plugins = agentPlugins.get(fi.agent.name);
    if (!plugins) continue;

    for (const pluginName of plugins) {
      const pluginManifest = resolvePlugin(pluginName, fi.identityResult);
      for (const [key, secret] of Object.entries(pluginManifest.secrets)) {
        if (!secret.autoResolvable) continue;

        const roleUpper = fi.agent.role.toUpperCase();
        const agent = resolvedAgents.find((a) => a.name === fi.agent.name);

        // Check if already in manifest plugin config
        const existingPluginConfig = agent?.plugins?.[pluginName] as Record<string, unknown> | undefined;
        if (existingPluginConfig?.[key]) {
          if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
          autoResolvedSecrets[fi.agent.role][key] = existingPluginConfig[key] as string;
          continue;
        }

        // Check if set as env var
        const envValue = envDict[`${roleUpper}_${secret.envVar}`];
        if (envValue) {
          if (!autoResolvedSecrets[fi.agent.role]) autoResolvedSecrets[fi.agent.role] = {};
          autoResolvedSecrets[fi.agent.role][key] = envValue;
          continue;
        }
      }
    }
  }

  // Run onboard hooks (always — this is the standalone command)
  await runOnboardHooks({
    fetchedIdentities,
    agentPlugins,
    resolvePlugin,
    autoResolvedSecrets,
    envDict,
    resolvedSecrets,
    p,
    runOnboardHook,
    exitWithError,
    skipOnboard: false,
  });

  p.outro("Onboard complete!");
}
