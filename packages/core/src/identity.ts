/**
 * Identity loader — fetches agent identities from Git repos or local paths.
 *
 * An identity is a directory containing an `identity.yaml` manifest and
 * workspace files (SOUL.md, IDENTITY.md, skills/, etc.) that define an agent's
 * persona and capabilities.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { createHash } from "crypto";
import YAML from "yaml";
import type { IdentityManifest, IdentityResult } from "./types";
import { IdentityManifestSchema } from "./schemas";

/** Result of a captured command execution */
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Simple command runner for git operations.
 * No vendored binary resolution needed — only used for git clone/pull/rm.
 */
function capture(command: string, args: string[] = [], cwd?: string): ExecResult {
  try {
    const result = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? "").toString().trim(),
      exitCode: e.status ?? 1,
    };
  }
}


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
 * Validate and parse an identity manifest object using Zod schema.
 * Throws with descriptive errors if required fields are missing or malformed.
 */
export function parseManifest(raw: unknown, sourcePath: string): IdentityManifest {
  const result = IdentityManifestSchema.safeParse(raw);

  if (!result.success) {
    // Build a human-readable error message from Zod issues
    const issues = result.error.issues;

    // Check for missing required fields
    const missingFields = issues
      .filter((i) => i.code === "invalid_type" && i.received === "undefined")
      .map((i) => i.path.join("."));

    if (missingFields.length > 0) {
      throw new Error(
        `identity manifest at ${sourcePath} is missing required fields: ${missingFields.join(", ")}`
      );
    }

    // For other errors, use the first issue's message
    const firstIssue = issues[0];
    const fieldPath = firstIssue.path.length > 0 ? `"${firstIssue.path.join(".")}"` : "root";
    throw new Error(`identity manifest: ${fieldPath} — ${firstIssue.message}`);
  }

  return result.data;
}

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
