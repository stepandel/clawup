/**
 * Project root detection for clawup manifests.
 *
 * Walks up from process.cwd() looking for clawup.yaml to determine
 * whether the CLI is running inside a clawup project directory.
 */

import * as fs from "fs";
import * as path from "path";
import { MANIFEST_FILE } from "@clawup/core";

/**
 * Walk up from `startDir` looking for a directory that contains MANIFEST_FILE.
 * Returns the directory path if found, or null if the filesystem root is reached.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, MANIFEST_FILE))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Returns true when the CLI is invoked from within a clawup project
 * (i.e. a clawup.yaml exists in the current directory or any ancestor).
 */
export function isProjectMode(): boolean {
  return findProjectRoot() !== null;
}

/**
 * Returns the project root directory, or throws if not inside a clawup project.
 */
export function getProjectRoot(): string {
  const root = findProjectRoot();
  if (root === null) {
    throw new Error(`${MANIFEST_FILE} not found in current directory or any parent`);
  }
  return root;
}
