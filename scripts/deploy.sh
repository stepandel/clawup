#!/usr/bin/env bash
#
# deploy.sh - Deploy the Clawup stack
#
# Thin wrapper around: clawup deploy
#
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

CLI_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)  CLI_ARGS+=(-c "$2"); shift 2 ;;
        -y|--yes)    CLI_ARGS+=(-y); shift ;;
        -h|--help)   require_node; ensure_built; exec node "$CLI_BIN" deploy --help ;;
        *)           echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

require_node
ensure_built
exec node "$CLI_BIN" deploy "${CLI_ARGS[@]+"${CLI_ARGS[@]}"}"
