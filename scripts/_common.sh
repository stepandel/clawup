#!/usr/bin/env bash
#
# _common.sh - Shared helpers for clawup wrapper scripts
#
# Source this file from any wrapper script:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLI_BIN="$PROJECT_DIR/dist/cli/bin.js"

require_node() {
    if ! command -v node &>/dev/null; then
        echo "Error: Node.js is required but not found." >&2
        echo "Install from https://nodejs.org/" >&2
        exit 1
    fi
}

ensure_built() {
    if [ ! -f "$CLI_BIN" ]; then
        echo "CLI not built yet — building..."
        (cd "$PROJECT_DIR" && pnpm run build)
    fi
}
