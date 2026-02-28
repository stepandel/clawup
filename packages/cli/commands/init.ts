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

/** Fetched identity data stored alongside the identity path */
interface FetchedIdentity {
  identityPath: string;
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
      fetchedIdentities.push({ identityPath, manifest: identity.manifest });
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

  // Slim agent entries — only identity path, fields resolved at deploy time
  const agents = fetchedIdentities.map((fi) => ({ identity: fi.identityPath }));

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
  writeManifest(manifest, fetchedIdentities, process.cwd());

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

  // Discover local identities and match to manifest agents
  const identityCacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
  const fetchedIdentities: FetchedIdentity[] = [];

  const identitySpinner = p.spinner();
  identitySpinner.start("Discovering local identities...");

  const identityPaths = discoverIdentities(projectRoot);

  // Fetch each discovered identity (resolve relative to projectRoot)
  const discovered: DiscoveredIdentity[] = [];
  for (const relPath of identityPaths) {
    try {
      const absPath = path.resolve(projectRoot, relPath);
      const identity = await fetchIdentity(absPath, identityCacheDir);
      discovered.push({ relPath, manifest: identity.manifest });
    } catch (err) {
      p.log.warn(
        `Could not fetch discovered identity "${relPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Match discovered identities to manifest agents
  const { matched, unmatchedAgents, unmatchedPaths } = matchIdentitiesToAgents(agents, discovered);

  // Update identity path for matched agents (slim: only update identity path)
  for (const { agent, discovered: d } of matched) {
    agent.identity = d.relPath;

    const identity = await fetchIdentity(path.resolve(projectRoot, d.relPath), identityCacheDir);
    fetchedIdentities.push({ identityPath: d.relPath, manifest: identity.manifest });
  }

  // Fallback for unmatched agents: try fetching their existing identity path
  for (const agent of unmatchedAgents) {
    p.log.warn(`Agent "${agent.identity}" has no matching local identity directory`);
    try {
      const identity = await fetchIdentity(agent.identity, identityCacheDir);
      fetchedIdentities.push({ identityPath: agent.identity, manifest: identity.manifest });
    } catch (err) {
      p.log.warn(
        `Could not resolve identity "${agent.identity}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Warn about discovered identities not in the manifest
  for (const relPath of unmatchedPaths) {
    p.log.warn(
      `Discovered identity "${relPath}" does not match any agent in ${MANIFEST_FILE}. ` +
      `Add it manually or re-run \`clawup init\` from scratch.`
    );
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

  // Write updated manifest
  writeManifest(manifest, fetchedIdentities, projectRoot);

  p.log.success(`${MANIFEST_FILE} and .env.example updated`);
  p.outro("Run `clawup setup` to validate secrets and configure Pulumi.");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A discovered identity path paired with its fetched manifest */
interface DiscoveredIdentity {
  /** Relative path as returned by discoverIdentities (e.g., "./pm") */
  relPath: string;
  manifest: IdentityManifest;
}

/** Result of matching discovered identities to manifest agents */
interface MatchResult {
  /** Agents matched to a discovered identity */
  matched: { agent: AgentDefinition; discovered: DiscoveredIdentity }[];
  /** Agents with no matching discovered identity */
  unmatchedAgents: AgentDefinition[];
  /** Discovered identity paths with no matching agent */
  unmatchedPaths: string[];
}

/**
 * Three-tier matching of discovered identities to manifest agents.
 *
 * - Tier 1: Exact identity path match (`agent.identity === relPath`)
 * - Tier 2: Name match (`agent.name === "agent-" + identity.manifest.name`)
 * - Tier 3: Unique role match (`agent.role === identity.manifest.role`,
 *           only when both sides have a single unmatched candidate for that role)
 */
export function matchIdentitiesToAgents(
  agents: AgentDefinition[],
  discovered: DiscoveredIdentity[],
): MatchResult {
  const matched: MatchResult["matched"] = [];
  const remainingAgents = new Set(agents);
  const remainingDiscovered = new Set(discovered);

  // Tier 1: exact path match
  for (const agent of remainingAgents) {
    for (const d of remainingDiscovered) {
      if (agent.identity === d.relPath) {
        matched.push({ agent, discovered: d });
        remainingAgents.delete(agent);
        remainingDiscovered.delete(d);
        break;
      }
    }
  }

  // Tier 2: name match (agent.name === "agent-" + manifest.name)
  for (const agent of remainingAgents) {
    if (!agent.name) continue;
    for (const d of remainingDiscovered) {
      if (agent.name === `agent-${d.manifest.name}`) {
        matched.push({ agent, discovered: d });
        remainingAgents.delete(agent);
        remainingDiscovered.delete(d);
        break;
      }
    }
  }

  // Tier 3: unique role match
  // Only match when exactly one unmatched agent and one unmatched identity share a role
  const agentsByRole = new Map<string, AgentDefinition[]>();
  for (const agent of remainingAgents) {
    const role = agent.role;
    if (!role) continue;
    const list = agentsByRole.get(role) ?? [];
    list.push(agent);
    agentsByRole.set(role, list);
  }

  const discoveredByRole = new Map<string, DiscoveredIdentity[]>();
  for (const d of remainingDiscovered) {
    const list = discoveredByRole.get(d.manifest.role) ?? [];
    list.push(d);
    discoveredByRole.set(d.manifest.role, list);
  }

  for (const [role, agentsForRole] of agentsByRole) {
    const discoveredForRole = discoveredByRole.get(role);
    if (agentsForRole.length === 1 && discoveredForRole?.length === 1) {
      const agent = agentsForRole[0];
      const d = discoveredForRole[0];
      matched.push({ agent, discovered: d });
      remainingAgents.delete(agent);
      remainingDiscovered.delete(d);
    }
  }

  return {
    matched,
    unmatchedAgents: [...remainingAgents],
    unmatchedPaths: [...remainingDiscovered].map((d) => d.relPath),
  };
}

/**
 * Write/update clawup.yaml + .env.example with current identity data.
 * Slim manifest: agent entries are minimal, secrets/plugins derived at deploy time.
 */
function writeManifest(
  manifest: ClawupManifest,
  fetchedIdentities: FetchedIdentity[],
  outputDir: string,
): void {
  const s = p.spinner();
  s.start(`Writing ${MANIFEST_FILE}...`);

  // Build global secrets from identity data (for .env.example)
  const allPluginNames = new Set<string>();
  const allDepNames = new Set<string>();
  const agentPlugins = new Map<string, Set<string>>();
  const agentDeps = new Map<string, Set<string>>();
  const allModels: string[] = [];

  for (const fi of fetchedIdentities) {
    const agentName = `agent-${fi.manifest.name}`;
    const plugins = new Set(fi.manifest.plugins ?? []);
    const deps = new Set(fi.manifest.deps ?? []);
    agentPlugins.set(agentName, plugins);
    agentDeps.set(agentName, deps);
    for (const pl of plugins) allPluginNames.add(pl);
    for (const d of deps) allDepNames.add(d);
    allModels.push(fi.manifest.model ?? "anthropic/claude-opus-4-6");
    if (fi.manifest.backupModel) allModels.push(fi.manifest.backupModel);
  }

  // Build secrets for global section + .env.example generation
  const manifestSecrets = buildManifestSecrets({
    provider: manifest.provider,
    agents: fetchedIdentities.map((fi) => ({
      name: `agent-${fi.manifest.name}`,
      role: fi.manifest.role,
      displayName: fi.manifest.displayName,
      requiredSecrets: fi.manifest.requiredSecrets,
    })),
    allPluginNames,
    allDepNames,
    agentPlugins,
    agentDeps,
    allModels,
  });

  // Set global secrets on manifest (not per-agent — those are derived at deploy time)
  const existingGlobal = { ...(manifest.secrets ?? {}) };
  for (const key of manifestSecrets.managedGlobalKeys) {
    if (!(key in manifestSecrets.global)) {
      delete existingGlobal[key];
    }
  }
  manifest.secrets = { ...existingGlobal, ...manifestSecrets.global };

  // Write manifest
  const manifestPath = path.join(outputDir, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");

  // Generate .env.example (uses identity data for agent info)
  const envExampleContent = generateEnvExample({
    globalSecrets: manifest.secrets ?? {},
    agents: fetchedIdentities.map((fi) => ({
      name: `agent-${fi.manifest.name}`,
      displayName: fi.manifest.displayName,
      role: fi.manifest.role,
    })),
    perAgentSecrets: manifestSecrets.perAgent,
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
