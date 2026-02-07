#!/usr/bin/env bash
#
# destroy.sh - Tear down the Agent Army stack with confirmation
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

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Destroy the Agent Army Pulumi stack.

Options:
    -s, --stack STACK   Pulumi stack name (default: dev)
    -y, --yes           Skip confirmation prompt (DANGEROUS!)
    -h, --help          Show this help message

Examples:
    $(basename "$0")              # Destroy 'dev' stack with confirmation
    $(basename "$0") -s prod      # Destroy 'prod' stack
    $(basename "$0") -y           # Force destroy without prompts
EOF
    exit 0
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# Parse arguments
STACK="dev"
SKIP_CONFIRM=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)
            STACK="$2"
            shift 2
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Header
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           🦞 Agent Army - Destroy Script                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Change to project directory
cd "$PROJECT_DIR"

# Check if stack exists
log_info "Checking stack: $STACK"
if ! pulumi stack select "$STACK" &>/dev/null; then
    log_error "Stack '$STACK' not found."
    exit 1
fi

# Show current resources
log_info "Current resources in stack '$STACK':"
echo ""
pulumi stack --show-urns 2>/dev/null | head -30 || true
echo ""

# Confirmation prompt
if [ "$SKIP_CONFIRM" = false ]; then
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                        ⚠️  WARNING                         ║${NC}"
    echo -e "${RED}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  This will PERMANENTLY DESTROY:                           ║${NC}"
    echo -e "${RED}║    • 3 EC2 instances (pm, eng, tester)                     ║${NC}"
    echo -e "${RED}║    • All workspace data on those instances                 ║${NC}"
    echo -e "${RED}║    • VPC, subnet, and security group                       ║${NC}"
    echo -e "${RED}║                                                            ║${NC}"
    echo -e "${RED}║  This action CANNOT be undone!                             ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    echo -n "Type the stack name to confirm destruction [$STACK]: "
    read -r CONFIRM_STACK
    
    if [ "$CONFIRM_STACK" != "$STACK" ]; then
        log_info "Confirmation failed. Destruction cancelled."
        exit 0
    fi
    
    echo ""
    read -p "Are you ABSOLUTELY sure? [y/N] " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Destruction cancelled."
        exit 0
    fi
fi

# Destroy
echo ""
log_warn "Destroying stack: $STACK"
echo ""

pulumi destroy --yes

echo ""
log_success "Stack '$STACK' has been destroyed."
echo ""
log_info "Tailscale nodes may take a few minutes to disappear from your tailnet."
log_info "Check status with: tailscale status"
