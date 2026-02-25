/**
 * Sync the Pulumi infrastructure build into the CLI's bundled infra/ directory.
 *
 * Copies:
 *   packages/pulumi/dist/  → packages/cli/infra/dist/
 *   packages/core/dist/    → packages/cli/infra/node_modules/@clawup/core/dist/
 *   packages/core/package.json → packages/cli/infra/node_modules/@clawup/core/package.json
 */

import { cpSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const repoRoot = join(cliRoot, "..", "..");

const pulumiDist = join(repoRoot, "packages", "pulumi", "dist");
const coreDist = join(repoRoot, "packages", "core", "dist");
const corePkg = join(repoRoot, "packages", "core", "package.json");

const infraDist = join(cliRoot, "infra", "dist");
const infraCore = join(cliRoot, "infra", "node_modules", "@clawup", "core");

// Sync pulumi dist → infra/dist
rmSync(infraDist, { recursive: true, force: true });
cpSync(pulumiDist, infraDist, { recursive: true });

// Sync core dist → infra/node_modules/@clawup/core
mkdirSync(infraCore, { recursive: true });
rmSync(join(infraCore, "dist"), { recursive: true, force: true });
cpSync(coreDist, join(infraCore, "dist"), { recursive: true });
cpSync(corePkg, join(infraCore, "package.json"));

console.log("✓ Infra bundle synced (pulumi + core)");
