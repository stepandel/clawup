#!/usr/bin/env bash
#
# validate.sh - Health check all deployed agents
#
# Thin wrapper around: clawup validate
#
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

CLI_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)    CLI_ARGS+=(-c "$2"); shift 2 ;;
        -t|--timeout)  CLI_ARGS+=(-t "$2"); shift 2 ;;
        -h|--help)     require_node; ensure_built; exec node "$CLI_BIN" validate --help ;;
        *)             echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

require_node
ensure_built
exec node "$CLI_BIN" validate "${CLI_ARGS[@]+"${CLI_ARGS[@]}"}"
