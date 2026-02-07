#!/usr/bin/env bash
#
# ssh.sh - Quick SSH to agent by name via Tailscale
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Agent mappings
declare -A AGENTS=(
    ["pm"]="agent-pm"
    ["eng"]="agent-eng"
    ["tester"]="agent-tester"
    # Aliases
    ["sage"]="agent-pm"
    ["atlas"]="agent-eng"
    ["scout"]="agent-tester"
)

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] AGENT [COMMAND...]

SSH to an agent via Tailscale.

Arguments:
    AGENT       Agent name: pm|eng|tester (or alias: sage|atlas|scout)
    COMMAND     Optional command to run on the agent

Options:
    -s, --stack STACK   Pulumi stack name (default: dev)
    -u, --user USER     SSH user (default: stars)
    -h, --help          Show this help message

Examples:
    $(basename "$0") pm                          # Interactive shell on PM agent
    $(basename "$0") eng                         # Interactive shell on Eng agent
    $(basename "$0") tester                      # Interactive shell on Tester agent
    
    $(basename "$0") atlas                       # Using agent alias
    
    $(basename "$0") pm 'openclaw gateway status'   # Run command
    $(basename "$0") eng 'cat ~/.openclaw/workspace/SOUL.md'
    
    $(basename "$0") -s prod tester              # SSH to prod stack

Agent Names:
    pm      → Sage    (Project Manager)
    eng     → Atlas   (Lead Engineer)
    tester  → Scout   (QA Tester)
EOF
    exit 0
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
STACK="dev"
USER="stars"
AGENT=""
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)
            STACK="$2"
            shift 2
            ;;
        -u|--user)
            USER="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            ;;
        *)
            if [ -z "$AGENT" ]; then
                AGENT="$1"
            else
                # Everything else is the command
                shift
                COMMAND="$*"
                break
            fi
            shift
            ;;
    esac
done

# Validate agent argument
if [ -z "$AGENT" ]; then
    log_error "Agent name required"
    echo ""
    usage
fi

# Convert to lowercase
AGENT=$(echo "$AGENT" | tr '[:upper:]' '[:lower:]')

# Look up hostname
if [[ ! -v AGENTS[$AGENT] ]]; then
    log_error "Unknown agent: $AGENT"
    echo ""
    echo "Valid agents: pm, eng, tester (or aliases: sage, atlas, scout)"
    exit 1
fi

HOSTNAME=${AGENTS[$AGENT]}

# Get tailnet from Pulumi config
cd "$PROJECT_DIR"

if ! pulumi stack select "$STACK" &>/dev/null; then
    log_error "Stack '$STACK' not found"
    exit 1
fi

TAILNET=$(pulumi config get tailnetDnsName 2>/dev/null || echo "")

if [ -z "$TAILNET" ]; then
    log_error "Could not determine tailnet DNS name from Pulumi config"
    exit 1
fi

SSH_HOST="${HOSTNAME}.${TAILNET}"

# Execute SSH
if [ -z "$COMMAND" ]; then
    log_info "Connecting to ${HOSTNAME} (${SSH_HOST})..."
    exec ssh -o StrictHostKeyChecking=no "${USER}@${SSH_HOST}"
else
    log_info "Running command on ${HOSTNAME}..."
    exec ssh -o StrictHostKeyChecking=no "${USER}@${SSH_HOST}" "$COMMAND"
fi
