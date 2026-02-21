#!/usr/bin/env bash
#
# ssh.sh - SSH to an agent by name via Tailscale
#
# Thin wrapper around: clawup ssh
#
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

CLI_ARGS=()
POSITIONAL=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)  CLI_ARGS+=(-c "$2"); shift 2 ;;
        -u|--user)   CLI_ARGS+=(-u "$2"); shift 2 ;;
        -h|--help)   require_node; ensure_built; exec node "$CLI_BIN" ssh --help ;;
        -*)          echo "Unknown option: $1" >&2; exit 1 ;;
        *)           POSITIONAL+=("$1"); shift ;;
    esac
done

require_node
ensure_built
exec node "$CLI_BIN" ssh "${CLI_ARGS[@]+"${CLI_ARGS[@]}"}" "${POSITIONAL[@]+"${POSITIONAL[@]}"}"
