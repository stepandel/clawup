/**
 * Prerequisite checking for CLI
 */

import * as p from "@clack/prompts";
import type { PrereqResult } from "../types";
import { commandExists, capture } from "./exec";
import { isVendored } from "./vendor";
import { isDevMode } from "./workspace";
import { isTailscaleInstalled } from "./tailscale";

/**
 * Run all prerequisite checks and display results.
 * Returns true if all pass, false otherwise.
 */
export async function checkPrerequisites(): Promise<boolean> {
  const results: PrereqResult[] = [];

  // Pulumi CLI
  if (commandExists("pulumi")) {
    const ver = capture("pulumi", ["version"]);
    const source = isVendored("pulumi") ? "vendored" : "system";
    results.push({ name: "Pulumi", ok: true, message: `found (${ver.stdout}, ${source})` });
  } else {
    results.push({
      name: "Pulumi",
      ok: false,
      message: "not found",
      hint: "Install from https://www.pulumi.com/docs/iac/download-install/ or run `npm install` to vendor automatically",
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
    const source = isVendored("aws") ? "vendored" : "system";
    results.push({ name: "AWS CLI", ok: true, message: `found (${source})` });
  } else {
    results.push({
      name: "AWS CLI",
      ok: false,
      message: "not found",
      hint: "Install from https://aws.amazon.com/cli/ or run `npm install` to vendor automatically",
    });
  }

  // Tailscale
  if (isTailscaleInstalled()) {
    results.push({ name: "Tailscale", ok: true, message: "found" });
  } else {
    const hint =
      process.platform === "darwin"
        ? "Install from the Mac App Store or https://tailscale.com/download"
        : "Install from https://tailscale.com/download";
    results.push({
      name: "Tailscale",
      ok: false,
      message: "not found",
      hint,
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
