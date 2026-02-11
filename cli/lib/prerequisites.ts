/**
 * Prerequisite checking for CLI
 */

import * as p from "@clack/prompts";
import type { PrereqResult } from "../types";
import { commandExists, capture } from "./exec";
import { isDevMode } from "./workspace";

/**
 * Run all prerequisite checks and display results.
 * Returns true if all pass, false otherwise.
 */
export async function checkPrerequisites(): Promise<boolean> {
  const results: PrereqResult[] = [];

  // Pulumi CLI
  if (commandExists("pulumi")) {
    const ver = capture("pulumi", ["version"]);
    results.push({ name: "Pulumi", ok: true, message: `found (${ver.stdout})` });
  } else {
    results.push({
      name: "Pulumi",
      ok: false,
      message: "not found",
      hint: "Install from https://www.pulumi.com/docs/iac/download-install/",
    });
  }

  // Node.js 18+
  if (commandExists("node")) {
    const ver = capture("node", ["-v"]);
    const major = parseInt(ver.stdout.replace("v", "").split(".")[0], 10);
    if (major >= 18) {
      results.push({ name: "Node.js", ok: true, message: `${ver.stdout} (>= 18 required)` });
    } else {
      results.push({
        name: "Node.js",
        ok: false,
        message: `${ver.stdout} is too old`,
        hint: "Requires Node.js 18+. Install from https://nodejs.org/",
      });
    }
  } else {
    results.push({
      name: "Node.js",
      ok: false,
      message: "not found",
      hint: "Install from https://nodejs.org/",
    });
  }

  // AWS CLI
  if (commandExists("aws")) {
    results.push({ name: "AWS CLI", ok: true, message: "found" });
  } else {
    results.push({
      name: "AWS CLI",
      ok: false,
      message: "not found",
      hint: "Install from https://aws.amazon.com/cli/",
    });
  }

  // pnpm (only required in dev mode — installed mode uses npm in the workspace)
  if (isDevMode()) {
    if (commandExists("pnpm")) {
      results.push({ name: "pnpm", ok: true, message: "found" });
    } else {
      results.push({
        name: "pnpm",
        ok: false,
        message: "not found",
        hint: "Install with: npm install -g pnpm",
      });
    }
  }

  // Display results
  const allOk = results.every((r) => r.ok);

  for (const r of results) {
    if (r.ok) {
      p.log.success(`${r.name}: ${r.message}`);
    } else {
      p.log.error(`${r.name}: ${r.message}`);
      if (r.hint) {
        p.log.message(`  ${r.hint}`);
      }
    }
  }

  return allOk;
}
