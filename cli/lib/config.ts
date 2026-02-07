/**
 * Load/save agent-army.json manifest
 */

import * as fs from "fs";
import * as path from "path";
import type { ArmyManifest } from "../types";
import { MANIFEST_FILE } from "./constants";

/**
 * Get the absolute path to the manifest file
 */
export function manifestPath(): string {
  return path.join(process.cwd(), MANIFEST_FILE);
}

/**
 * Check if the manifest file exists
 */
export function manifestExists(): boolean {
  return fs.existsSync(manifestPath());
}

/**
 * Load the manifest from disk. Returns null if not found or invalid.
 */
export function loadManifest(): ArmyManifest | null {
  const filePath = manifestPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ArmyManifest;
  } catch {
    return null;
  }
}

/**
 * Save the manifest to disk
 */
export function saveManifest(manifest: ArmyManifest): void {
  const filePath = manifestPath();
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}
