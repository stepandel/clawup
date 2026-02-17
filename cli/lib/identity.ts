/**
 * Identity loader — fetches agent identities from Git repos or local paths.
 *
 * An identity is a directory containing an `identity.json` manifest and
 * workspace files (SOUL.md, IDENTITY.md, skills/, etc.) that define an agent's
 * persona and capabilities.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { createHash } from "crypto";
import { capture } from "./exec";
import type { IdentityManifest, IdentityResult } from "../types";

/** Required fields in identity.json */
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
 *   - Local paths: `./identities/juno`, `/abs/path/to/identity`
 *   - Git URLs: `https://github.com/org/repo`
 *   - Git URLs with subfolder: `https://github.com/org/repo#subfolder`
 */
function parseSource(source: string): { type: "local"; path: string } | { type: "git"; url: string; subfolder?: string } {
  // Local path — starts with `.`, `/`, or doesn't look like a URL
  if (source.startsWith(".") || source.startsWith("/") || !source.includes("://")) {
    return { type: "local", path: source };
  }

  // Git URL — optionally with #subfolder
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
 * Validate linearRouting field structure.
 */
function validateLinearRouting(value: unknown): IdentityManifest["linearRouting"] {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`identity.json: "linearRouting" must be an object`);
  }
  const lr = value as Record<string, unknown>;
  if (lr.add !== undefined && !Array.isArray(lr.add)) {
    throw new Error(`identity.json: "linearRouting.add" must be an array`);
  }
  if (lr.remove !== undefined && !Array.isArray(lr.remove)) {
    throw new Error(`identity.json: "linearRouting.remove" must be an array`);
  }
  return value as IdentityManifest["linearRouting"];
}

/**
 * Validate and parse an identity.json object.
 * Throws with descriptive errors if required fields are missing or malformed.
 */
function parseManifest(raw: unknown, sourcePath: string): IdentityManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`identity.json at ${sourcePath} is not a valid object`);
  }

  const obj = raw as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((f) => !(f in obj));

  if (missing.length > 0) {
    throw new Error(
      `identity.json at ${sourcePath} is missing required fields: ${missing.join(", ")}`
    );
  }

  // Type checks
  if (typeof obj.name !== "string") throw new Error(`identity.json: "name" must be a string`);
  if (typeof obj.displayName !== "string") throw new Error(`identity.json: "displayName" must be a string`);
  if (typeof obj.role !== "string") throw new Error(`identity.json: "role" must be a string`);
  if (typeof obj.emoji !== "string") throw new Error(`identity.json: "emoji" must be a string`);
  if (typeof obj.description !== "string") throw new Error(`identity.json: "description" must be a string`);
  if (typeof obj.volumeSize !== "number") throw new Error(`identity.json: "volumeSize" must be a number`);
  if (!Array.isArray(obj.skills)) throw new Error(`identity.json: "skills" must be an array`);
  if (!Array.isArray(obj.templateVars)) throw new Error(`identity.json: "templateVars" must be an array`);

  return {
    name: obj.name as string,
    displayName: obj.displayName as string,
    role: obj.role as string,
    emoji: obj.emoji as string,
    description: obj.description as string,
    volumeSize: obj.volumeSize as number,
    instanceType: typeof obj.instanceType === "string" ? obj.instanceType : undefined,
    skills: obj.skills as string[],
    linearRouting: validateLinearRouting(obj.linearRouting),
    templateVars: obj.templateVars as string[],
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
 * // From a Git mono-repo
 * const id = await fetchIdentity("https://github.com/org/identities#juno", cacheDir);
 *
 * // From a local path
 * const id = await fetchIdentity("./identities/juno", cacheDir);
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

  // Read and parse identity.json
  const manifestPath = join(identityDir, "identity.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`identity.json not found in ${identityDir}`);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse identity.json in ${identityDir}: ${(err as Error).message}`);
  }

  const manifest = parseManifest(rawJson, identityDir);

  // Read all files (excluding identity.json itself and .git)
  const allFiles = readFilesRecursive(identityDir);
  delete allFiles["identity.json"];

  return { manifest, files: allFiles };
}
