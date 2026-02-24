/**
 * Load/save clawup manifests from ~/.clawup/configs/
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import YAML from "yaml";
import type { ClawupManifest, PluginConfigFile } from "@clawup/core";
import { CONFIG_DIR, MANIFEST_FILE, PLUGINS_DIR } from "@clawup/core";
import { findProjectRoot } from "./project";

/**
 * Get the configs directory path (~/.clawup/configs/)
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
  return path.join(configsDir(), `${name}.yaml`);
}

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
 * Project mode: reads <projectRoot>/clawup.yaml, resolves relative identity
 *               paths, and writes to <projectRoot>/.clawup/clawup.yaml
 * Global mode:  copies ~/.clawup/configs/<name>.yaml → <projectDir|cwd>/clawup.yaml
 */
export function syncManifestToProject(name: string, projectDir?: string): void {
  const startDir = projectDir ?? process.cwd();
  const projectRoot = findProjectRoot(startDir);
  const src = projectRoot !== null
    ? path.join(projectRoot, MANIFEST_FILE)
    : configPath(name);
  const dest = path.join(projectDir ?? process.cwd(), MANIFEST_FILE);

  if (projectRoot !== null) {
    const raw = fs.readFileSync(src, "utf-8");
    const manifest = YAML.parse(raw) as ClawupManifest;
    const resolved = resolveIdentityPaths(manifest, projectRoot);
    fs.writeFileSync(dest, YAML.stringify(resolved), "utf-8");
  } else {
    fs.copyFileSync(src, dest);
  }
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
export function loadManifest(name: string): ClawupManifest | null {
  const filePath = configPath(name);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return YAML.parse(raw) as ClawupManifest;
  } catch (err) {
    console.warn(`[config] Failed to load manifest '${name}' at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Save a manifest by name
 */
export function saveManifest(name: string, manifest: ClawupManifest): void {
  ensureConfigsDir();
  const filePath = configPath(name);
  fs.writeFileSync(filePath, YAML.stringify(manifest), "utf-8");
}

/**
 * List all saved config names
 */
export function listManifests(): string[] {
  const dir = configsDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
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
        throw new Error(`Config '${name}' not found. No configs exist. Run 'clawup init' to create one.`);
      }
      throw new Error(
        `Config '${name}' not found. Available configs:\n  ${available.join("\n  ")}`
      );
    }
    return name;
  }

  const configs = listManifests();

  if (configs.length === 0) {
    throw new Error("No configs found. Run 'clawup init' to create one.");
  }

  if (configs.length === 1) {
    return configs[0];
  }

  throw new Error(
    `Multiple configs found. Specify one with --config:\n  ${configs.join("\n  ")}`
  );
}

// ---------------------------------------------------------------------------
// Plugin config helpers (deprecated — plugin config is now inline in manifest)
// These remain for backward compat and the `config migrate` command.
// ---------------------------------------------------------------------------

/**
 * Get the plugins directory for a stack (~/.clawup/configs/<stackName>/plugins/)
 * @deprecated Plugin config is now inline in the manifest. Use `clawup config migrate` to upgrade.
 */
export function pluginsDir(stackName: string): string {
  return path.join(configsDir(), stackName, PLUGINS_DIR);
}

/**
 * Ensure the plugins directory exists for a stack
 * @deprecated Plugin config is now inline in the manifest.
 */
export function ensurePluginsDir(stackName: string): void {
  const dir = pluginsDir(stackName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load a plugin config file. Returns null if not found or invalid.
 * @deprecated Plugin config is now inline in the manifest. Use `clawup config migrate` to upgrade.
 */
export function loadPluginConfig(stackName: string, pluginName: string): PluginConfigFile | null {
  const filePath = path.join(pluginsDir(stackName), `${pluginName}.yaml`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return YAML.parse(raw) as PluginConfigFile;
  } catch (err) {
    console.warn(`[config] Failed to load plugin config '${pluginName}' for stack '${stackName}': ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Save a plugin config file
 * @deprecated Plugin config is now inline in the manifest. Use `clawup config migrate` to upgrade.
 */
export function savePluginConfig(stackName: string, pluginName: string, data: PluginConfigFile): void {
  ensurePluginsDir(stackName);
  const filePath = path.join(pluginsDir(stackName), `${pluginName}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), "utf-8");
}
