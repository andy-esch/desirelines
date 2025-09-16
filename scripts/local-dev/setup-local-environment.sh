#!/bin/bash
# Complete local development environment setup for Desire Lines
# This script orchestrates all the steps needed for local development

set -e

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

    cd packages/dispatcher
    go mod download
    cd ../..

    echo -e "${GREEN}✅ Go dependencies installed${NC}"
    echo ""
}

# Function to create .env file if needed
setup_env_file() {
    echo -e "${BLUE}⚙️  Setting up environment configuration...${NC}"

    if [ ! -f ".env" ]; then
        echo -e "${YELLOW}📝 Creating .env file from template...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}⚠️  Please edit .env file with your actual values before running services${NC}"
    else
        echo -e "${GREEN}✅ .env file already exists${NC}"
    fi
    echo ""
}

# Function to display development mode options
show_development_modes() {
    echo -e "${BLUE}🔧 Available Development Modes:${NC}"
    echo ""
    echo -e "${GREEN}1. Pure Local Mode (make start)${NC}"
    echo "   - Uses PubSub emulator + local storage simulation"
    echo "   - Completely isolated, no GCP dependencies"
    echo "   - Best for: Offline development, testing pipeline logic"
    echo ""
    echo -e "${GREEN}2. Hybrid Local Mode (make start-local)${NC}"
    echo "   - Uses Terraform-managed BigQuery & Cloud Storage"
    echo "   - PubSub emulator for messaging"
    echo "   - Best for: Realistic testing with real data persistence"
    echo "   - Requires: GCP authentication and Terraform setup"
    echo ""
    echo -e "${GREEN}3. Frontend Development (--profile frontend)${NC}"
    echo "   - Add React web app and API gateway"
    echo "   - Can be combined with either mode above"
    echo "   - Best for: Full-stack development and UI work"
    echo ""
}

# Function to show next steps
show_next_steps() {
    echo -e "${BLUE}🎯 Next Steps:${NC}"
    echo ""
    echo -e "${GREEN}For Pure Local Development:${NC}"
    echo "   make start                    # Start all services"
    echo "   make test-full-flow          # Test the pipeline"
    echo "   make logs                    # View logs"
    echo ""
    echo -e "${GREEN}For Hybrid Local Development:${NC}"
    echo "   make setup-local             # Setup Terraform"
    echo "   make tf-local-apply          # Create GCP resources"
    echo "   make start-local             # Start with real GCP"
    echo ""
    echo -e "${GREEN}For Frontend Development:${NC}"
    echo "   make start --profile frontend           # Local + UI"
    echo "   make start-local --profile frontend     # Hybrid + UI"
    echo ""
    echo -e "${GREEN}Common Commands:${NC}"
    echo "   make stop                    # Stop all services"
    echo "   make clean                   # Clean up everything"
    echo "   make help                    # Show all commands"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    setup_python
    setup_go
    setup_env_file
    show_development_modes
    show_next_steps

    echo -e "${GREEN}🎉 Local development environment setup complete!${NC}"
    echo ""
    echo -e "${YELLOW}💡 Pro tip: Start with 'make start' for your first time${NC}"
}

# Run main function
main "$@"
