/**
 * Identity loader — fetches agent identities from Git repos or local paths.
 *
 * An identity is a directory containing an `identity.yaml` manifest and
 * workspace files (SOUL.md, IDENTITY.md, skills/, etc.) that define an agent's
 * persona and capabilities.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { createHash } from "crypto";
import YAML from "yaml";
import { capture } from "./exec";
import type { IdentityManifest, IdentityResult } from "../types";

/** Required fields in identity manifest */
const REQUIRED_FIELDS: (keyof IdentityManifest)[] = [
  "name",
  "displayName",
  "role",
  "emoji",
  "description",
  "volumeSize",
  "skills",
  "templateVars",
];

/**
 * Parse a source string into its components.
 * Supports:
 *   - Local paths: `./my-identity`, `/abs/path/to/identity`
 *   - Git HTTPS URLs: `https://github.com/org/repo#subfolder`
 *   - Git SSH URLs: `git@github.com:org/repo#subfolder`
 */
function parseSource(source: string): { type: "local"; path: string } | { type: "git"; url: string; subfolder?: string } {
  // Local path — starts with `.` or `/`
  if (source.startsWith(".") || source.startsWith("/")) {
    return { type: "local", path: source };
  }

  // SSH-style Git URL (git@host:org/repo or user@host:path)
  if (source.startsWith("git@") || /^[\w.-]+@[\w.-]+:/.test(source)) {
    return parseGitUrl(source);
  }

  // HTTPS Git URL — contains ://
  if (source.includes("://")) {
    return parseGitUrl(source);
  }

  // Fallback: treat as local path
  return { type: "local", path: source };
}

function parseGitUrl(source: string): { type: "git"; url: string; subfolder?: string } {
  const hashIdx = source.indexOf("#");
  if (hashIdx === -1) {
    return { type: "git", url: source };
  }
  return {
    type: "git",
    url: source.slice(0, hashIdx),
    subfolder: source.slice(hashIdx + 1),
  };
}

/**
 * Generate a stable cache key for a Git URL.
 */
function cacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Clone or update a Git repo into the cache directory.
 * Returns the path to the cloned repo.
 */
function ensureRepo(url: string, cacheDir: string): string {
  mkdirSync(cacheDir, { recursive: true });

  const repoDir = join(cacheDir, cacheKey(url));

  if (existsSync(join(repoDir, ".git"))) {
    // Cache hit — pull latest
    const result = capture("git", ["pull", "--ff-only"], repoDir);
    if (result.exitCode !== 0) {
      // Pull failed (e.g., diverged) — re-clone
      capture("rm", ["-rf", repoDir]);
      const clone = capture("git", ["clone", "--depth", "1", url, repoDir]);
      if (clone.exitCode !== 0) {
        throw new Error(`Failed to clone ${url}: ${clone.stderr}`);
      }
    }
  } else {
    // Cache miss — shallow clone
    const result = capture("git", ["clone", "--depth", "1", url, repoDir]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to clone ${url}: ${result.stderr}`);
    }
  }

  return repoDir;
}

/**
 * Recursively read all files in a directory, returning a map of
 * relative paths to file contents (text files only).
 */
function readFilesRecursive(dir: string, base?: string): Record<string, string> {
  const root = base ?? dir;
  const files: Record<string, string> = {};

  for (const entry of readdirSync(dir)) {
    // Skip hidden dirs (e.g., .git)
    if (entry.startsWith(".")) continue;

    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      Object.assign(files, readFilesRecursive(full, root));
    } else if (stat.isFile()) {
      const rel = relative(root, full);
      try {
        files[rel] = readFileSync(full, "utf-8");
      } catch {
        // Skip binary / unreadable files
      }
    }
  }

  return files;
}

/**
 * Validate plugins field (optional array of strings).
 */
function validatePlugins(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`identity manifest: "plugins" must be an array of strings`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(`identity manifest: each plugin must be a non-empty string`);
    }
  }
  return value as string[];
}

/**
 * Validate pluginDefaults field (optional record of records).
 */
function validatePluginDefaults(value: unknown): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`identity manifest: "pluginDefaults" must be an object`);
  }
  const pd = value as Record<string, unknown>;
  for (const [key, val] of Object.entries(pd)) {
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      throw new Error(`identity manifest: "pluginDefaults.${key}" must be an object`);
    }
  }
  return value as Record<string, Record<string, unknown>>;
}

/**
 * Validate and parse an identity manifest object.
 * Throws with descriptive errors if required fields are missing or malformed.
 */
function parseManifest(raw: unknown, sourcePath: string): IdentityManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`identity manifest at ${sourcePath} is not a valid object`);
  }

  const obj = raw as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((f) => !(f in obj));

  if (missing.length > 0) {
    throw new Error(
      `identity manifest at ${sourcePath} is missing required fields: ${missing.join(", ")}`
    );
  }

  // Type checks
  if (typeof obj.name !== "string") throw new Error(`identity manifest: "name" must be a string`);
  if (typeof obj.displayName !== "string") throw new Error(`identity manifest: "displayName" must be a string`);
  if (typeof obj.role !== "string") throw new Error(`identity manifest: "role" must be a string`);
  if (typeof obj.emoji !== "string") throw new Error(`identity manifest: "emoji" must be a string`);
  if (typeof obj.description !== "string") throw new Error(`identity manifest: "description" must be a string`);
  if (typeof obj.volumeSize !== "number") throw new Error(`identity manifest: "volumeSize" must be a number`);
  if (!Array.isArray(obj.skills)) throw new Error(`identity manifest: "skills" must be an array`);
  if (!Array.isArray(obj.templateVars)) throw new Error(`identity manifest: "templateVars" must be an array`);

  return {
    name: obj.name as string,
    displayName: obj.displayName as string,
    role: obj.role as string,
    emoji: obj.emoji as string,
    description: obj.description as string,
    volumeSize: obj.volumeSize as number,
    instanceType: typeof obj.instanceType === "string" ? obj.instanceType : undefined,
    skills: obj.skills as string[],
    plugins: validatePlugins(obj.plugins),
    pluginDefaults: validatePluginDefaults(obj.pluginDefaults),
    templateVars: obj.templateVars as string[],
    model: typeof obj.model === "string" ? obj.model : undefined,
    backupModel: typeof obj.backupModel === "string" ? obj.backupModel : undefined,
    codingAgent: typeof obj.codingAgent === "string" ? obj.codingAgent : undefined,
    deps: Array.isArray(obj.deps) ? obj.deps as string[] : undefined,
  };
}

/**
 * Fetch an agent identity from a Git repo or local path.
 *
 * @param source - Git URL (with optional `#subfolder`), or a local directory path
 * @param cacheDir - Directory to cache cloned Git repos (e.g., `~/.agent-army/identity-cache/`)
 * @returns Parsed identity manifest and all workspace files
 *
 * @example
 * ```ts
 * // From a Git repo with subfolder
 * const id = await fetchIdentity("https://github.com/org/identities#pm", cacheDir);
 *
 * // From a local path
 * const id = await fetchIdentity("./my-identity", cacheDir);
 * ```
 */
/**
 * Synchronous version of fetchIdentity for use in contexts that don't support async
 * (e.g., Pulumi resource construction).
 */
export function fetchIdentitySync(source: string, cacheDir: string): IdentityResult {
  return _fetchIdentity(source, cacheDir);
}

export async function fetchIdentity(source: string, cacheDir: string): Promise<IdentityResult> {
  return _fetchIdentity(source, cacheDir);
}

function _fetchIdentity(source: string, cacheDir: string): IdentityResult {
  const parsed = parseSource(source);
  let identityDir: string;

  if (parsed.type === "local") {
    identityDir = resolve(parsed.path);
  } else {
    const repoDir = ensureRepo(parsed.url, cacheDir);
    identityDir = parsed.subfolder ? join(repoDir, parsed.subfolder) : repoDir;
  }

  // Verify the directory exists
  if (!existsSync(identityDir) || !statSync(identityDir).isDirectory()) {
    throw new Error(`Identity directory not found: ${identityDir}`);
  }

  // Read and parse identity manifest (prefer .yaml, fall back to .json for third-party compat)
  const yamlPath = join(identityDir, "identity.yaml");
  const jsonPath = join(identityDir, "identity.json");
  let manifestPath: string;
  let manifestFilename: string;

  if (existsSync(yamlPath)) {
    manifestPath = yamlPath;
    manifestFilename = "identity.yaml";
  } else if (existsSync(jsonPath)) {
    manifestPath = jsonPath;
    manifestFilename = "identity.json";
  } else {
    throw new Error(`identity.yaml not found in ${identityDir}`);
  }

  let raw: unknown;
  try {
    const content = readFileSync(manifestPath, "utf-8");
    raw = manifestFilename.endsWith(".yaml") ? YAML.parse(content) : JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse ${manifestFilename} in ${identityDir}: ${(err as Error).message}`);
  }

  const manifest = parseManifest(raw, identityDir);

  // Read all files (excluding the manifest file itself and .git)
  const allFiles = readFilesRecursive(identityDir);
  delete allFiles[manifestFilename];

  return { manifest, files: allFiles };
}
