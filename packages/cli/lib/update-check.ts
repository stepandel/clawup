/**
 * Background update notifier — checks npm for newer versions
 */

import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import pc from "picocolors";

const PACKAGE_NAME = "clawup";
const CACHE_FILE = ".update-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;

interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
}

function getCacheDir(): string {
  // Previously ~/.agent-army — users upgrading from the old name will start a fresh cache
  return path.join(os.homedir(), ".clawup");
}

function getCachePath(): string {
  return path.join(getCacheDir(), CACHE_FILE);
}

function loadCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(getCachePath(), "utf-8");
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

function saveCache(cache: UpdateCache): void {
  const dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getCachePath(), JSON.stringify(cache), "utf-8");
}

/**
 * Compare two semver strings. Returns:
 *  1 if a > b, -1 if a < b, 0 if equal
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { timeout: FETCH_TIMEOUT_MS },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.version ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * Check for updates and print a notice if a newer version is available.
 * Non-blocking — errors are silently ignored.
 */
export async function checkForUpdates(currentVersion: string): Promise<void> {
  try {
    const cache = loadCache();
    const now = Date.now();

    // Use cached version if fresh enough
    if (cache && now - cache.lastChecked < CHECK_INTERVAL_MS) {
      if (compareSemver(cache.latestVersion, currentVersion) > 0) {
        printUpdateNotice(currentVersion, cache.latestVersion);
      }
      return;
    }

    // Fetch in background — don't block CLI exit
    const latest = await fetchLatestVersion();
    if (!latest) {
      // Cache the current version so we don't retry on every CLI run
      saveCache({ lastChecked: now, latestVersion: currentVersion });
      return;
    }

    saveCache({ lastChecked: now, latestVersion: latest });

    if (compareSemver(latest, currentVersion) > 0) {
      printUpdateNotice(currentVersion, latest);
    }
  } catch {
    // Never fail the CLI over an update check
  }
}

function printUpdateNotice(current: string, latest: string): void {
  console.log();
  console.log(
    `  Update available: ${pc.dim(current)} ${pc.dim("→")} ${pc.green(latest)}`
  );
  console.log(`  Run ${pc.cyan("clawup update")} to install`);
  console.log();
}
