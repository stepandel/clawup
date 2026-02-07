#!/usr/bin/env bash
#
# validate.sh - Health check all deployed agents via Tailscale SSH
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

# Agent definitions: name -> tailscale hostname pattern
declare -A AGENTS=(
    ["pm"]="agent-pm"
    ["eng"]="agent-eng"
    ["tester"]="agent-tester"
)

declare -A AGENT_NAMES=(
    ["pm"]="Sage (PM)"
    ["eng"]="Atlas (Eng)"
    ["tester"]="Scout (Tester)"
)

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Health check all deployed agents via Tailscale SSH.

Options:
    -s, --stack STACK     Pulumi stack name (default: dev)
    -t, --timeout SEC     SSH timeout in seconds (default: 30)
    -v, --verbose         Show detailed output
    -h, --help            Show this help message

Checks performed per agent:
    1. Tailscale SSH connectivity
    2. OpenClaw gateway status (running)
    3. Workspace files exist (SOUL.md, HEARTBEAT.md)

Examples:
    $(basename "$0")              # Validate all agents
    $(basename "$0") -v           # Verbose output
    $(basename "$0") -t 60        # Extended timeout for slow networks
EOF
    exit 0
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }

# Parse arguments
STACK="dev"
TIMEOUT=30
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--stack)
            STACK="$2"
            shift 2
            ;;
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
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
echo "║           🦞 Agent Army - Validation Script               ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
if ! command -v tailscale &> /dev/null; then
    log_error "Tailscale CLI not found. Install from https://tailscale.com/download"
    exit 1
fi

# Get tailnet domain from Pulumi
cd "$PROJECT_DIR"

log_info "Fetching configuration from Pulumi stack: $STACK"

# Select stack
if ! pulumi stack select "$STACK" &>/dev/null; then
    log_error "Stack '$STACK' not found. Deploy first with: ./scripts/deploy.sh"
    exit 1
fi

# Get tailnet DNS name from config
TAILNET=$(pulumi config get tailnetDnsName 2>/dev/null || echo "")

if [ -z "$TAILNET" ]; then
    log_error "Could not determine tailnet DNS name from Pulumi config"
    exit 1
fi

log_info "Tailnet: $TAILNET"
echo ""

# Validate each agent
TOTAL=0
PASSED=0
FAILED=0

validate_agent() {
    local agent_key=$1
    local agent_hostname=${AGENTS[$agent_key]}
    local agent_display=${AGENT_NAMES[$agent_key]}
    local ssh_host="${agent_hostname}.${TAILNET}"
    local user="stars"
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BLUE}Checking: ${agent_display}${NC}"
    echo "Host: ${ssh_host}"
    echo ""
    
    local agent_passed=true
    
    # Check 1: SSH connectivity
    log_info "Testing SSH connectivity..."
    if ssh -o ConnectTimeout="$TIMEOUT" -o StrictHostKeyChecking=no -o BatchMode=yes \
        "${user}@${ssh_host}" "echo 'SSH OK'" &>/dev/null; then
        log_success "SSH connection established"
    else
        log_error "SSH connection failed"
        agent_passed=false
    fi
    
    if [ "$agent_passed" = true ]; then
        # Check 2: OpenClaw gateway status
        log_info "Checking OpenClaw gateway status..."
        local gateway_status
        gateway_status=$(ssh -o ConnectTimeout="$TIMEOUT" -o StrictHostKeyChecking=no \
            "${user}@${ssh_host}" "openclaw gateway status 2>&1" || echo "ERROR")
        
        if [ "$VERBOSE" = true ]; then
            echo "  Gateway output: $gateway_status"
        fi
        
        if echo "$gateway_status" | grep -qi "running"; then
            log_success "OpenClaw gateway is running"
        else
            log_error "OpenClaw gateway not running"
            agent_passed=false
        fi
        
        # Check 3: Workspace files exist
        log_info "Checking workspace files..."
        local workspace_path="/home/${user}/.openclaw/workspace"
        
        # Check SOUL.md
        if ssh -o ConnectTimeout="$TIMEOUT" -o StrictHostKeyChecking=no \
            "${user}@${ssh_host}" "test -f ${workspace_path}/SOUL.md" &>/dev/null; then
            log_success "SOUL.md exists"
        else
            log_error "SOUL.md missing"
            agent_passed=false
        fi
        
        # Check HEARTBEAT.md
        if ssh -o ConnectTimeout="$TIMEOUT" -o StrictHostKeyChecking=no \
            "${user}@${ssh_host}" "test -f ${workspace_path}/HEARTBEAT.md" &>/dev/null; then
            log_success "HEARTBEAT.md exists"
        else
            log_error "HEARTBEAT.md missing"
            agent_passed=false
        fi
        
        # Show additional info in verbose mode
        if [ "$VERBOSE" = true ]; then
            log_info "Workspace contents:"
            ssh -o ConnectTimeout="$TIMEOUT" -o StrictHostKeyChecking=no \
                "${user}@${ssh_host}" "ls -la ${workspace_path}/" 2>/dev/null || true
        fi
    fi
    
    echo ""
    
    ((TOTAL++))
    if [ "$agent_passed" = true ]; then
        ((PASSED++))
        echo -e "${GREEN}Result: PASS ✓${NC}"
    else
        ((FAILED++))
        echo -e "${RED}Result: FAIL ✗${NC}"
    fi
    echo ""
}

# Run validation for each agent
for agent_key in "${!AGENTS[@]}"; do
    validate_agent "$agent_key"
done

# Summary
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "                        SUMMARY"
echo ""
echo -e "  Total Agents:  ${TOTAL}"
echo -e "  ${GREEN}Passed:${NC}        ${PASSED}"
echo -e "  ${RED}Failed:${NC}        ${FAILED}"
echo ""

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}All agents are healthy! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some agents failed validation. Check logs above.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Wait 3-5 minutes for cloud-init to complete"
    echo "  2. Check agent logs: ./scripts/ssh.sh <agent> 'journalctl -u openclaw'"
    echo "  3. Verify Tailscale status: tailscale status"
    exit 1
fi
