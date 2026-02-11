#!/usr/bin/env bash
#
# Bundle infrastructure files into cli/infra/ for npm publishing.
# Run after `pnpm build` (root) so dist/ exists.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/cli/infra"

echo "Bundling infrastructure into cli/infra/ ..."

# Clean previous bundle
rm -rf "$INFRA"
mkdir -p "$INFRA/dist/src/components"

# --- Pulumi.yaml (npm instead of pnpm) ---
cat > "$INFRA/Pulumi.yaml" <<'EOF'
name: agent-army
description: Multi-agent OpenClaw deployment - PM, Engineer, and Tester
runtime:
  name: nodejs
  options:
    packagemanager: npm
EOF

# --- package.json (Pulumi SDK deps only) ---
# Extract dependency versions from root package.json
node -e "
  const pkg = require('$ROOT/package.json');
  const deps = {};
  for (const name of ['@pulumi/pulumi', '@pulumi/aws', '@pulumi/hcloud', '@pulumi/tls']) {
    if (pkg.dependencies[name]) deps[name] = pkg.dependencies[name];
  }
  const out = { name: 'agent-army-infra', private: true, main: 'dist/index.js', dependencies: deps };
  console.log(JSON.stringify(out, null, 2));
" > "$INFRA/package.json"

# --- Compiled Pulumi program (.js only) ---
cp "$ROOT/dist/index.js"      "$INFRA/dist/"
cp "$ROOT/dist/shared-vpc.js"  "$INFRA/dist/"
cp "$ROOT/dist/src/index.js"   "$INFRA/dist/src/"

for f in "$ROOT/dist/src/components/"*.js; do
  [ -f "$f" ] && cp "$f" "$INFRA/dist/src/components/"
done

# --- Presets (full copy) ---
cp -r "$ROOT/presets" "$INFRA/presets"

echo "Done. Contents of cli/infra/:"
find "$INFRA" -type f | sed "s|$INFRA/||" | sort
