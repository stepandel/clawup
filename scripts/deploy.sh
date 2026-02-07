#!/usr/bin/env bash
#
# deploy.sh - Deploy the Agent Army stack with prerequisite checks
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

Deploy the Agent Army Pulumi stack with prerequisite validation.

Options:
    -s, --stack STACK   Pulumi stack name (default: dev)
    -y, --yes           Skip confirmation prompt
    -h, --help          Show this help message

Examples:
    $(basename "$0")              # Deploy to 'dev' stack with prompts
    $(basename "$0") -s prod      # Deploy to 'prod' stack
    $(basename "$0") -y           # Deploy without confirmation
EOF
    exit 0
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

check_command() {
    local cmd=$1
    local install_hint=$2
    
    if command -v "$cmd" &> /dev/null; then
        log_success "$cmd found: $(command -v "$cmd")"
        return 0
    else
        log_error "$cmd not found. $install_hint"
        return 1
    fi
}

check_node_version() {
    local required_major=18
    local node_version
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Install from https://nodejs.org/"
        return 1
    fi
    
    node_version=$(node -v | sed 's/v//' | cut -d. -f1)
    
    if [ "$node_version" -ge "$required_major" ]; then
        log_success "Node.js version: $(node -v) (>= v${required_major} required)"
        return 0
    else
        log_error "Node.js version $(node -v) is too old. Requires v${required_major}+"
        return 1
    fi
}

check_aws_credentials() {
    log_info "Checking AWS credentials..."
    
    if aws sts get-caller-identity &> /dev/null; then
        local account_id
        account_id=$(aws sts get-caller-identity --query Account --output text)
        log_success "AWS credentials valid (Account: $account_id)"
        return 0
    else
        log_error "AWS credentials not configured or invalid"
        log_info "Configure with: aws configure"
        return 1
    fi
}

check_pulumi_logged_in() {
    log_info "Checking Pulumi login status..."
    
    if pulumi whoami &> /dev/null; then
        local user
        user=$(pulumi whoami)
        log_success "Pulumi logged in as: $user"
        return 0
    else
        log_error "Not logged in to Pulumi"
        log_info "Login with: pulumi login"
        return 1
    fi
}

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
echo "║           🦞 Agent Army - Deployment Script               ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Prerequisite checks
log_info "Checking prerequisites..."
echo ""

PREREQS_OK=true

check_command "pulumi" "Install from https://www.pulumi.com/docs/iac/download-install/" || PREREQS_OK=false
check_node_version || PREREQS_OK=false
check_command "aws" "Install from https://aws.amazon.com/cli/" || PREREQS_OK=false
check_command "npm" "Install with Node.js from https://nodejs.org/" || PREREQS_OK=false

echo ""

check_aws_credentials || PREREQS_OK=false
check_pulumi_logged_in || PREREQS_OK=false

echo ""

if [ "$PREREQS_OK" = false ]; then
    log_error "Prerequisite checks failed. Please fix the issues above and retry."
    exit 1
fi

log_success "All prerequisites satisfied!"
echo ""

# Change to project directory
cd "$PROJECT_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    log_info "Installing npm dependencies..."
    npm install
    echo ""
fi

# Select stack
log_info "Selecting stack: $STACK"
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
echo ""

# Confirmation prompt
if [ "$SKIP_CONFIRM" = false ]; then
    echo -e "${YELLOW}This will deploy 3 EC2 instances to AWS (t3.medium each).${NC}"
    echo -e "${YELLOW}Estimated monthly cost: ~\$100 USD${NC}"
    echo ""
    read -p "Continue with deployment? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled."
        exit 0
    fi
fi

# Deploy
echo ""
log_info "Starting Pulumi deployment..."
echo ""

pulumi up

echo ""
log_success "Deployment complete!"
echo ""
log_info "Agents will be ready in 3-5 minutes (cloud-init setup)."
log_info "Validate with: ./scripts/validate.sh"
