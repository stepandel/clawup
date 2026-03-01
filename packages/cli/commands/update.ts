/**
 * Update the clawup CLI to the latest version
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { stream } from "../lib/exec";
import * as fs from "fs";
import * as path from "path";

interface UpdateOptions {
  // reserved for future flags
}

export async function updateCommand(_opts: UpdateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" Clawup — Update ")));

  const s = p.spinner();
  s.start("Checking npm for latest version…");

  // Fetch latest version info
  const { default: https } = await import("https");
  const latest = await new Promise<string | null>((resolve) => {
    const req = https.get(
      "https://registry.npmjs.org/clawup/latest",
      { timeout: 5000 },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });

  if (!latest) {
    s.stop("Failed to reach npm registry");
    p.log.error("Could not check for updates. Check your internet connection.");
    process.exit(1);
  }

  // Read current version — resolve package root for both tsc and esbuild bundle
  const oneUp = path.resolve(__dirname, "..");
  const pkgRoot = fs.existsSync(path.join(oneUp, "package.json")) ? oneUp : path.resolve(__dirname, "..", "..");
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8")
  );
  const current: string = pkgJson.version;

  s.stop(`Current: ${pc.dim(current)}  Latest: ${pc.green(latest)}`);

  // Compare versions
  const cParts = current.split(".").map(Number);
  const lParts = latest.split(".").map(Number);
  let isOutdated = false;
  for (let i = 0; i < 3; i++) {
    if ((lParts[i] ?? 0) > (cParts[i] ?? 0)) { isOutdated = true; break; }
    if ((lParts[i] ?? 0) < (cParts[i] ?? 0)) break;
  }

  if (!isOutdated) {
    p.log.success("You're already on the latest version!");
    p.outro("Done");
    return;
  }

  // Warn on major version bump
  const curMajor = parseInt(current.split(".")[0], 10);
  const latMajor = parseInt(latest.split(".")[0], 10);
  if (latMajor > curMajor) {
    p.log.warn(
      `${pc.yellow("Major version update")} — this may include breaking changes.\n` +
      `  See ${pc.dim("https://github.com/stepandel/clawup/releases")} for details.\n` +
      `  Key changes in v${latMajor}.x:\n` +
      `  • \`clawup init\` is now non-interactive (generates scaffold, edit YAML by hand)\n` +
      `  • \`clawup deploy\` now handles setup automatically (no separate setup step)\n` +
      `  • Run \`clawup init\` on existing projects to refresh your manifest`
    );
    console.log();
  }

  p.log.step(`Updating ${pc.dim(current)} → ${pc.green(latest)}`);
  console.log();

  // Retry logic: npm registry metadata can propagate before the tarball is
  // available on the CDN, causing ETARGET errors on freshly-published versions.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 10_000;
  let exitCode = 1;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    exitCode = await stream("npm", ["install", "-g", `clawup@${latest}`]);
    if (exitCode === 0) break;

    if (attempt < MAX_RETRIES) {
      console.log();
      p.log.warn(
        `Install failed (attempt ${attempt}/${MAX_RETRIES}). ` +
        `Retrying in ${RETRY_DELAY_MS / 1000}s — the new version may still be propagating…`
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      console.log();
    }
  }

  console.log();
  if (exitCode === 0) {
    p.log.success(`Updated to ${pc.green(latest)}`);
  } else {
    p.log.error("Update failed. You may need to run with sudo:");
    p.log.message(`  sudo npm install -g clawup@${latest}`);
    process.exit(1);
  }

  p.outro("Done");
}
