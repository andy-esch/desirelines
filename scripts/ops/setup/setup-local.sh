#!/usr/bin/env bash
# Complete local development environment setup for Desire Lines
# This script orchestrates all the steps needed for local development

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏗️  Desire Lines - Local Development Setup${NC}"
echo "=================================================="
echo ""

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
  echo -e "${BLUE}🔍 Checking prerequisites...${NC}"

  local missing_deps=()

  if ! command_exists uv; then
    missing_deps+=("uv (Python package manager)")
  fi

  if ! command_exists docker; then
    missing_deps+=("docker")
  fi

  if ! command_exists go; then
    missing_deps+=("go")
  fi

  if ! command_exists just; then
    missing_deps+=("just (Task runner)")
  fi

  if ! command_exists infisical; then
    missing_deps+=("infisical (Secret management)")
  fi

  if [ ${#missing_deps[@]} -ne 0 ]; then
    echo -e "${RED}❌ Missing dependencies:${NC}"
    for dep in "${missing_deps[@]}"; do
      echo "   - $dep"
    done
    echo ""
    echo "Please install missing dependencies and try again."
    exit 1
  fi

  echo -e "${GREEN}✅ All prerequisites found${NC}"
  echo ""
}

# Function to setup Python dependencies
setup_python() {
  echo -e "${BLUE}🐍 Setting up Python dependencies...${NC}"

  if [ ! -f "pyproject.toml" ]; then
    echo -e "${RED}❌ Not in project root directory${NC}"
    exit 1
  fi

  uv sync
  echo -e "${GREEN}✅ Python dependencies installed${NC}"
  echo ""
}

# Function to setup Go dependencies
setup_go() {
  echo -e "${BLUE}🚀 Setting up Go dependencies...${NC}"

  echo "   📥 Syncing dispatcher..."
  (cd packages/dispatcher && go mod download)
  echo "   📥 Syncing apigateway..."
  (cd packages/apigateway && go mod download)

  echo -e "${GREEN}✅ Go dependencies installed${NC}"
  echo ""
}

# Function to setup environment config from Infisical
setup_secrets() {
  echo -e "${BLUE}⚙️  Setting up environment configuration via Infisical...${NC}"

  if ! infisical status >/dev/null 2>&1; then
    echo -e "${YELLOW}🔑 You are not logged into Infisical.${NC}"
    echo "Please run: infisical login"
    infisical login
  fi

  echo -e "${YELLOW}🔐 Syncing secrets...${NC}"
  if just setup-secrets; then
    echo -e "${GREEN}✅ Secrets synced and environment files generated${NC}"
  else
    echo -e "${RED}❌ Failed to sync secrets. Make sure you have access to the 'desirelines' project.${NC}"
    exit 1
  fi
  echo ""
}

# Function to display development mode options
show_development_modes() {
  echo -e "${BLUE}🔧 Available Development Modes:${NC}"
  echo ""
  echo -e "${GREEN}1. Backend Mode (just start)${NC}"
  echo "   - Uses PubSub emulator + local storage simulation"
  echo "   - Best for: Pipeline logic and data processing"
  echo ""
  echo -e "${GREEN}2. Full Stack Mode (just start-frontend)${NC}"
  echo "   - Adds React web app and API gateway"
  echo "   - Best for: UI work and end-to-end features"
  echo ""
}

# Function to show next steps
show_next_steps() {
  echo -e "${BLUE}🎯 Next Steps:${NC}"
  echo ""
  echo -e "${GREEN}Common Commands:${NC}"
  echo "   just start                    # Start backend services"
  echo "   just start-frontend           # Start backend + frontend"
  echo "   just stop                     # Stop all services"
  echo "   just logs                     # View logs"
  echo "   just setup-secrets            # Refresh secrets from Infisical"
  echo ""
}

# Main execution
main() {
  check_prerequisites
  setup_python
  setup_go
  setup_secrets
  show_development_modes
  show_next_steps

  echo -e "${GREEN}🎉 Local development environment setup complete!${NC}"
  echo ""
  echo -e "${YELLOW}💡 Pro tip: Start with 'just start' for your first time${NC}"
}

# Run main function
main "$@"
