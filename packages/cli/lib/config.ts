/**
 * Load/save clawup manifests from the project root (clawup.yaml).
 *
 * Every deployment lives in a project directory with clawup.yaml at its root.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import YAML from "yaml";
import type { ClawupManifest, ResolvedManifest } from "@clawup/core";
import { MANIFEST_FILE } from "@clawup/core";
import { resolveManifestSync } from "@clawup/core/resolve";
import { findProjectRoot } from "./project";

/**
 * Rewrite relative identity paths (starting with ./ or ../) in agent definitions
 * to absolute paths resolved against projectRoot. Git URLs and already-absolute
 * paths are left unchanged.
 */
export function resolveIdentityPaths(manifest: ClawupManifest, projectRoot: string): ClawupManifest {
  if (!manifest.agents) return manifest;

  return {
    ...manifest,
    agents: manifest.agents.map((agent) => {
      if (agent.identity.startsWith("./") || agent.identity.startsWith("../")) {
        return {
          ...agent,
          identity: path.resolve(projectRoot, agent.identity),
        };
      }
      return agent;
    }),
  };
}

/**
 * Copy the manifest so the Pulumi program can read it.
 *
 * Reads <projectRoot>/clawup.yaml, resolves relative identity paths,
 * and writes to <projectDir|cwd>/clawup.yaml (the .clawup/ workspace).
 *
 * When `overrides` is provided, the resolved manifest is shallow-merged
 * with the overrides before writing. This allows --local to inject
 * `{ provider: "local" }` without modifying the user's manifest file.
 */
export function syncManifestToProject(
  projectDir?: string,
  overrides?: Partial<ClawupManifest>,
): void {
  const projectRoot = findProjectRoot();
  if (projectRoot === null) {
    throw new Error("syncManifestToProject: no project root found (no clawup.yaml in current directory or ancestors).");
  }

  const src = path.join(projectRoot, MANIFEST_FILE);
  const dest = path.join(projectDir ?? process.cwd(), MANIFEST_FILE);

  const raw = fs.readFileSync(src, "utf-8");
  const manifest = YAML.parse(raw) as ClawupManifest;
  const resolved = resolveIdentityPaths(manifest, projectRoot);
  const final = overrides ? { ...resolved, ...overrides } : resolved;
  fs.writeFileSync(dest, YAML.stringify(final), "utf-8");
}

/**
 * Check if a clawup.yaml exists in the project root.
 */
export function manifestExists(): boolean {
  const projectRoot = findProjectRoot();
  return projectRoot !== null && fs.existsSync(path.join(projectRoot, MANIFEST_FILE));
}

/**
 * Load the manifest from the project root. Returns null if not found or invalid.
 * Resolves relative identity paths.
 */
export function loadManifest(): ClawupManifest | null {
  const projectRoot = findProjectRoot();
  if (projectRoot === null) return null;
  const filePath = path.join(projectRoot, MANIFEST_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const manifest = YAML.parse(raw) as ClawupManifest;
    return resolveIdentityPaths(manifest, projectRoot);
  } catch (err) {
    console.warn(`[config] Failed to load project manifest at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load the manifest from the project root, or throw a descriptive error.
 * Replaces the resolveConfigName() + loadManifest() + null check pattern.
 */
export function requireManifest(): ClawupManifest {
  const projectRoot = findProjectRoot();
  if (projectRoot === null) {
    throw new Error("No clawup.yaml found. Run 'clawup init' to create one, or cd into your project directory.");
  }
  const filePath = path.join(projectRoot, MANIFEST_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error("No clawup.yaml found. Run 'clawup init' to create one, or cd into your project directory.");
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const manifest = YAML.parse(raw) as ClawupManifest;
    return resolveIdentityPaths(manifest, projectRoot);
  } catch (err) {
    throw new Error(`Failed to load clawup.yaml: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Save a manifest to the project root.
 */
export function saveManifest(manifest: ClawupManifest): void {
  const projectRoot = findProjectRoot();
  if (projectRoot === null) {
    throw new Error("Cannot save manifest: no project root found (no clawup.yaml in current directory or ancestors).");
  }
  const filePath = path.join(projectRoot, MANIFEST_FILE);
  fs.writeFileSync(filePath, YAML.stringify(manifest), "utf-8");
}

/**
 * Load the manifest from the project root and resolve all agent entries
 * by hydrating missing fields from their identities.
 * Returns a ResolvedManifest where every agent has name, displayName, role, volumeSize.
 */
export function requireResolvedManifest(): ResolvedManifest {
  const projectRoot = findProjectRoot();
  if (projectRoot === null) {
    throw new Error("No clawup.yaml found. Run 'clawup init' to create one, or cd into your project directory.");
  }
  const filePath = path.join(projectRoot, MANIFEST_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error("No clawup.yaml found. Run 'clawup init' to create one, or cd into your project directory.");
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const manifest = YAML.parse(raw) as ClawupManifest;
    const resolved = resolveIdentityPaths(manifest, projectRoot);
    const cacheDir = path.join(os.homedir(), ".clawup", "identity-cache");
    return resolveManifestSync(resolved, cacheDir);
  } catch (err) {
    throw new Error(`Failed to load clawup.yaml: ${err instanceof Error ? err.message : String(err)}`);
  }
}
