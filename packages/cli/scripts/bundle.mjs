/**
 * Bundle the CLI for npm publishing.
 *
 * Uses esbuild to inline @clawup/core into the CLI dist,
 * so it doesn't need to be published as a separate npm package.
 */

import { build } from "esbuild";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

// External: all real dependencies (installed from npm) + node builtins
const external = [
  ...Object.keys(pkg.dependencies || {}).filter((d) => d !== "@clawup/core"),
  ...Object.keys(pkg.devDependencies || {}).filter((d) => d !== "esbuild"),
];

await build({
  entryPoints: [join(__dirname, "..", "bin.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: join(__dirname, "..", "dist", "bin.js"),
  external,
  // Don't minify — keep readable for debugging
  minify: false,
  sourcemap: true,
});

console.log("✓ CLI bundled with @clawup/core inlined");
