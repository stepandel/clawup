#!/usr/bin/env bash
#
# Bundle infrastructure files into packages/cli/infra/ for npm publishing.
# Run after `pnpm -r build` so compiled JS exists.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PULUMI_DIST="$ROOT/packages/pulumi/dist"
CORE_ROOT="$ROOT/packages/core"
INFRA="$ROOT/packages/cli/infra"

echo "Bundling infrastructure into packages/cli/infra/ ..."

# Clean previous bundle
rm -rf "$INFRA"
mkdir -p "$INFRA/dist/components"

# --- Pulumi.yaml (npm instead of pnpm, flat dist structure) ---
cat > "$INFRA/Pulumi.yaml" <<'EOF'
name: clawup
description: Multi-agent OpenClaw deployment - PM, Engineer, and Tester
runtime:
  name: nodejs
  options:
    packagemanager: npm
EOF

# --- package.json (Pulumi SDK deps + yaml) ---
node -e "
  const pkg = require('$ROOT/packages/pulumi/package.json');
  const deps = {};
  for (const name of ['@pulumi/pulumi', '@pulumi/aws', '@pulumi/hcloud', '@pulumi/tls', 'yaml']) {
    if (pkg.dependencies[name]) deps[name] = pkg.dependencies[name];
  }
  const out = { name: 'clawup-infra', private: true, main: 'dist/index.js', dependencies: deps };
  console.log(JSON.stringify(out, null, 2));
" > "$INFRA/package.json"

# --- Compiled Pulumi program (.js only) ---
cp "$PULUMI_DIST/index.js"       "$INFRA/dist/"
cp "$PULUMI_DIST/shared-vpc.js"  "$INFRA/dist/"

for f in "$PULUMI_DIST/components/"*.js; do
  [ -f "$f" ] && cp "$f" "$INFRA/dist/components/"
done

# --- @clawup/core (workspace package, not on npm) ---
mkdir -p "$INFRA/node_modules/@clawup/core"
cp "$CORE_ROOT/package.json" "$INFRA/node_modules/@clawup/core/"
cp -r "$CORE_ROOT/dist" "$INFRA/node_modules/@clawup/core/dist"

echo "Done. Contents of packages/cli/infra/:"
find "$INFRA" -type f | sed "s|$INFRA/||" | sort
