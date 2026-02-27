/**
 * clawup init — Generate clawup.yaml scaffold
 *
 * Completely non-interactive. Discovers local identity directories (subdirectories
 * containing identity.yaml) and generates a template clawup.yaml with sensible
 * defaults (AWS us-east-1, t3.medium) and a .env.example.
 * The user then edits clawup.yaml by hand.
 *
 * Two modes:
 * - Fresh init (no clawup.yaml): discover local identities, scaffold a new manifest
 * - Repair mode (clawup.yaml exists): re-fetch identities, update secrets/plugins,
 *   regenerate .env.example — all non-interactively
 */

import * as fs from "fs";
import * as p from "@clack/prompts";
import YAML from "yaml";
import type { AgentDefinition, ClawupManifest, IdentityManifest } from "@clawup/core";
import {
  MANIFEST_FILE,
  ClawupManifestSchema,
} from "@clawup/core";
import { fetchIdentity, discoverIdentities } from "@clawup/core/identity";
import * as os from "os";
import * as path from "path";
import { showBanner, exitWithError } from "../lib/ui";
import { findProjectRoot } from "../lib/project";
import {
  buildManifestSecrets,
  generateEnvExample,
} from "../lib/env";

/** Fetched identity data stored alongside the agent definition */
interface FetchedIdentity {
  agent: AgentDefinition;
  manifest: IdentityManifest;
}

export async function initCommand(): Promise<void> {
  showBanner();

  // -------------------------------------------------------------------------
  // Check for existing manifest — enter repair mode if found
  // -------------------------------------------------------------------------
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    return repairMode(projectRoot);
  }

  // -------------------------------------------------------------------------
  // Fresh init: scaffold a new clawup.yaml with defaults
  // -------------------------------------------------------------------------
  p.log.step("Generating clawup.yaml from local identities...");

  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const fetchedIdentities: FetchedIdentity[] = [];

  // Discover local identity directories
  const spinner = p.spinner();
  spinner.start("Discovering local identities...");

  const identityPaths = discoverIdentities(process.cwd());
  if (identityPaths.length === 0) {
    spinner.stop("No identities found");
    exitWithError(
      "No identity directories found in the current directory.\n" +
      "Each identity should be a subdirectory containing an identity.yaml file.\n" +
      "Expected structure:\n" +
      "  ./pm/identity.yaml\n" +
      "  ./eng/identity.yaml\n" +
      "  ./tester/identity.yaml"
    );
    return;
  }

  for (const identityPath of identityPaths) {
    try {
      const identity = await fetchIdentity(identityPath, identityCacheDir);
      const agent: AgentDefinition = {
        name: `agent-${identity.manifest.name}`,
        displayName: identity.manifest.displayName,
        role: identity.manifest.role,
        identity: identityPath,
        volumeSize: identity.manifest.volumeSize,
      };
      fetchedIdentities.push({ agent, manifest: identity.manifest });
    } catch (err) {
      spinner.stop(`Failed to fetch identity: ${identityPath}`);
      exitWithError(
        `Could not fetch identity "${identityPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return;
    }
  }

  spinner.stop(`Discovered ${fetchedIdentities.length} local identit${fetchedIdentities.length === 1 ? "y" : "ies"}`);

  const agents = fetchedIdentities.map((fi) => fi.agent);

  // Build plugin/dep maps
  const { agentPlugins, agentDeps, allPluginNames, allDepNames, identityPluginDefaults, allModels } =
    buildPluginDepMaps(fetchedIdentities);

  // Collect all template vars declared by identities
  const allTemplateVarNames = new Set<string>();
  for (const fi of fetchedIdentities) {
    for (const v of fi.manifest.templateVars ?? []) {
      allTemplateVarNames.add(v);
    }
  }

  const ownerName = "Your Name";
  const timezone = "America/New_York";
  const workingHours = "9am-6pm";
  const userNotes = "Add any notes about yourself for your agents here.";

  // Populate templateVars so the user can see what's available for {{...}} substitution
  const templateVars: Record<string, string> = {
    OWNER_NAME: ownerName,
    TIMEZONE: timezone,
    WORKING_HOURS: workingHours,
    USER_NOTES: userNotes,
  };
  // Add any identity-declared vars not already covered
  for (const varName of allTemplateVarNames) {
    if (!templateVars[varName]) {
      templateVars[varName] = "";
    }
  }

  // Build manifest with defaults
  const manifest: ClawupManifest = {
    stackName: "dev",
    provider: "aws",
    region: "us-east-1",
    instanceType: "t3.medium",
    ownerName,
    timezone,
    workingHours,
    userNotes,
    templateVars,
    agents,
  };

  // Write manifest + .env.example
  writeManifest(manifest, fetchedIdentities, agentPlugins, agentDeps, allPluginNames, allDepNames, identityPluginDefaults, process.cwd(), allModels);

  p.log.success("Created clawup.yaml and .env.example");
  p.note(
    [
      "1. Edit clawup.yaml — set your provider, region, owner info, and agents",
      "2. Copy .env.example to .env and fill in your secrets",
      "3. Run `clawup setup` to validate and configure Pulumi",
      "4. Run `clawup deploy` to deploy your agents",
    ].join("\n"),
    "Next steps"
  );
  p.outro("Done!");
}

// ---------------------------------------------------------------------------
// Repair mode: clawup.yaml exists — refresh identities & update manifest
// ---------------------------------------------------------------------------

async function repairMode(projectRoot: string): Promise<void> {
  const manifestPath = path.join(projectRoot, MANIFEST_FILE);

  // Load and validate
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

  p.log.info(`Refreshing ${MANIFEST_FILE} at ${projectRoot}`);
  p.log.info(
    `Stack: ${manifest.stackName} | Provider: ${manifest.provider} | ${agents.length} agent(s)`
  );

  // Re-fetch identities
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const fetchedIdentities: FetchedIdentity[] = [];

  const identitySpinner = p.spinner();
  identitySpinner.start("Resolving agent identities...");
  for (const agent of agents) {
    try {
      const identity = await fetchIdentity(agent.identity, identityCacheDir);
      fetchedIdentities.push({ agent, manifest: identity.manifest });
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

  // Ensure auto vars are in templateVars (from top-level fields)
  const autoVarMap: Record<string, string | undefined> = {
    OWNER_NAME: manifest.ownerName,
    TIMEZONE: manifest.timezone,
    WORKING_HOURS: manifest.workingHours,
    USER_NOTES: manifest.userNotes,
  };
  const existingTemplateVars = manifest.templateVars ?? {};
  const templateVars: Record<string, string> = { ...existingTemplateVars };
  for (const [key, value] of Object.entries(autoVarMap)) {
    if (!templateVars[key] && value) {
      templateVars[key] = value;
    }
  }

  // Check for missing identity-declared vars (warn, don't prompt)
  const allTemplateVarNames = new Set<string>();
  for (const fi of fetchedIdentities) {
    for (const v of fi.manifest.templateVars ?? []) {
      allTemplateVarNames.add(v);
    }
  }
  const missingVars = [...allTemplateVarNames].filter((v) => !templateVars[v]);
  if (missingVars.length > 0) {
    p.log.warn(
      `Missing template variables in clawup.yaml: ${missingVars.join(", ")}\n` +
      `Add them under templateVars: in your manifest.`
    );
  }

  manifest.templateVars = templateVars;

  // Build plugin/dep maps
  const { agentPlugins, agentDeps, allPluginNames, allDepNames, identityPluginDefaults, allModels } =
    buildPluginDepMaps(fetchedIdentities);

  // Write updated manifest
  writeManifest(manifest, fetchedIdentities, agentPlugins, agentDeps, allPluginNames, allDepNames, identityPluginDefaults, projectRoot, allModels);

  p.log.success(`${MANIFEST_FILE} and .env.example updated`);
  p.outro("Run `clawup setup` to validate secrets and configure Pulumi.");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build plugin/dep maps and collect all model strings from fetched identities */
function buildPluginDepMaps(fetchedIdentities: FetchedIdentity[]) {
  const agentPlugins = new Map<string, Set<string>>();
  const agentDeps = new Map<string, Set<string>>();
  const allPluginNames = new Set<string>();
  const allDepNames = new Set<string>();
  const allModels: string[] = [];

  for (const fi of fetchedIdentities) {
    const plugins = new Set(fi.manifest.plugins ?? []);
    const deps = new Set(fi.manifest.deps ?? []);
    agentPlugins.set(fi.agent.name, plugins);
    agentDeps.set(fi.agent.name, deps);
    for (const pl of plugins) allPluginNames.add(pl);
    for (const d of deps) allDepNames.add(d);

    const model = fi.manifest.model ?? "anthropic/claude-opus-4-6";
    allModels.push(model);
    if (fi.manifest.backupModel) {
      allModels.push(fi.manifest.backupModel);
    }
  }

  const identityPluginDefaults: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const fi of fetchedIdentities) {
    if (fi.manifest.pluginDefaults) {
      identityPluginDefaults[fi.agent.name] = fi.manifest.pluginDefaults;
    }
  }

  return { agentPlugins, agentDeps, allPluginNames, allDepNames, identityPluginDefaults, allModels };
}

/** Write/update clawup.yaml + .env.example with current identity data */
function writeManifest(
  manifest: ClawupManifest,
  fetchedIdentities: FetchedIdentity[],
  agentPlugins: Map<string, Set<string>>,
  agentDeps: Map<string, Set<string>>,
  allPluginNames: Set<string>,
  allDepNames: Set<string>,
  identityPluginDefaults: Record<string, Record<string, Record<string, unknown>>>,
  outputDir: string,
  allModels: string[],
): void {
  const s = p.spinner();
  s.start(`Writing ${MANIFEST_FILE}...`);

  const agents = manifest.agents;

  // Build secrets section
  const manifestSecrets = buildManifestSecrets({
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
    allModels,
  });

  // Apply per-agent secrets
  for (const agent of agents) {
    const perAgentSec = manifestSecrets.perAgent[agent.name];
    if (perAgentSec && Object.keys(perAgentSec).length > 0) {
      agent.secrets = { ...(agent.secrets ?? {}), ...perAgentSec };
    }
  }
  manifest.secrets = { ...(manifest.secrets ?? {}), ...manifestSecrets.global };

  // Inline plugin config (minus linearUserUuid — set by setup)
  for (const fi of fetchedIdentities) {
    const rolePlugins = agentPlugins.get(fi.agent.name);
    if (!rolePlugins || rolePlugins.size === 0) continue;

    const inlinePlugins: Record<string, Record<string, unknown>> = {};
    const defaults = identityPluginDefaults[fi.agent.name] ?? {};
    // Preserve existing plugin config (e.g., linearUserUuid from a previous setup run)
    const existingPlugins = (fi.agent.plugins ?? {}) as Record<string, Record<string, unknown>>;

    for (const pluginName of rolePlugins) {
      const pluginDefaults = defaults[pluginName] ?? {};
      const existingConfig = existingPlugins[pluginName] ?? {};
      inlinePlugins[pluginName] = {
        ...pluginDefaults,
        ...existingConfig,
        agentId: fi.agent.name,
      };
    }

    if (Object.keys(inlinePlugins).length > 0) {
      fi.agent.plugins = inlinePlugins;
    }
  }

  // Write manifest
  const manifestPath = path.join(outputDir, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");

  // Generate .env.example
  const perAgentSecrets: Record<string, Record<string, string>> = {};
  for (const agent of agents) {
    if (agent.secrets) perAgentSecrets[agent.name] = agent.secrets;
  }
  const envExampleContent = generateEnvExample({
    globalSecrets: manifest.secrets ?? {},
    agents: agents.map((a) => ({ name: a.name, displayName: a.displayName, role: a.role })),
    perAgentSecrets,
  });
  fs.writeFileSync(path.join(outputDir, ".env.example"), envExampleContent, "utf-8");

  // Ensure .clawup/ and .env are in .gitignore
  const gitignorePath = path.join(outputDir, ".gitignore");
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

  s.stop("Config saved");
}
