/**
 * Load/save agent-army manifests from ~/.agent-army/configs/
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import type { ArmyManifest } from "../types";
import { CONFIG_DIR, MANIFEST_FILE } from "./constants";

/**
 * Get the configs directory path (~/.agent-army/configs/)
 */
export function configsDir(): string {
  return path.join(os.homedir(), CONFIG_DIR);
}

/**
 * Ensure the configs directory exists
 */
export function ensureConfigsDir(): void {
  const dir = configsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the path to a config file by name
 */
export function configPath(name: string): string {
  return path.join(configsDir(), `${name}.json`);
}

/**
 * Get the legacy manifest path (./agent-army.json in CWD)
 */
export function legacyManifestPath(): string {
  return path.join(process.cwd(), MANIFEST_FILE);
}

/**
 * Check if a legacy manifest exists in CWD
 */
export function legacyManifestExists(): boolean {
  return fs.existsSync(legacyManifestPath());
}

/**
 * Load a legacy manifest from CWD
 */
export function loadLegacyManifest(): ArmyManifest | null {
  const filePath = legacyManifestPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ArmyManifest;
  } catch {
    return null;
  }
}

/**
 * Prompt user for yes/no confirmation
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Check for legacy manifest and offer migration.
 * Returns the migrated config name if migration occurred, null otherwise.
 */
export async function checkAndMigrateLegacy(): Promise<string | null> {
  if (!legacyManifestExists()) return null;

  const legacy = loadLegacyManifest();
  if (!legacy) return null;

  console.log(
    `\nFound legacy config at ${legacyManifestPath()}`
  );
  console.log(`  Stack: ${legacy.stackName}`);
  console.log(`  Region: ${legacy.region}`);
  console.log(`  Agents: ${legacy.agents.length}`);

  const shouldMigrate = await confirm(
    "\nMigrate this config to ~/.agent-army/configs/?"
  );

  if (!shouldMigrate) {
    return null;
  }

  const configName = legacy.stackName;
  saveManifest(configName, legacy);
  console.log(`\nMigrated to: ${configPath(configName)}`);

  const shouldDelete = await confirm("Delete the old ./agent-army.json file?");
  if (shouldDelete) {
    fs.unlinkSync(legacyManifestPath());
    console.log("Deleted legacy config.");
  }

  return configName;
}

/**
 * Check if a config exists by name
 */
export function manifestExists(name: string): boolean {
  return fs.existsSync(configPath(name));
}

/**
 * Load a manifest by name. Returns null if not found or invalid.
 */
export function loadManifest(name: string): ArmyManifest | null {
  const filePath = configPath(name);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ArmyManifest;
  } catch {
    return null;
  }
}

/**
 * Save a manifest by name
 */
export function saveManifest(name: string, manifest: ArmyManifest): void {
  ensureConfigsDir();
  const filePath = configPath(name);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/**
 * List all saved config names
 */
export function listManifests(): string[] {
  const dir = configsDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/**
 * Delete a config by name. Returns true if deleted, false if not found.
 */
export function deleteManifest(name: string): boolean {
  const filePath = configPath(name);
  if (!fs.existsSync(filePath)) return false;

  fs.unlinkSync(filePath);
  return true;
}

/**
 * Resolve a config name: auto-selects if only one config exists,
 * errors with list if ambiguous or none found.
 * @param name Optional explicit config name
 * @returns The resolved config name
 * @throws Error if no configs exist or multiple configs exist without explicit name
 */
export function resolveConfigName(name?: string): string {
  if (name) {
    if (!manifestExists(name)) {
      const available = listManifests();
      if (available.length === 0) {
        throw new Error(`Config '${name}' not found. No configs exist. Run 'agent-army init' to create one.`);
      }
      throw new Error(
        `Config '${name}' not found. Available configs:\n  ${available.join("\n  ")}`
      );
    }
    return name;
  }

  const configs = listManifests();

  if (configs.length === 0) {
    throw new Error("No configs found. Run 'agent-army init' to create one.");
  }

  if (configs.length === 1) {
    return configs[0];
  }

  throw new Error(
    `Multiple configs found. Specify one with --config:\n  ${configs.join("\n  ")}`
  );
}
