#!/bin/bash

# =============================================================================
# ENTERPRISE MASTER RUNNER: FeedFactory Pro Full-Stack Execution System
# Version: 2026.03 - Phase 2 Ready (Multi-User & Cloud Sync)
# Author: Full-Stack Enterprise Architect (Fellow Grade)
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
PRISMA_DIR="$BACKEND_DIR/prisma"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is not installed. Please install it first."
        exit 1
    fi
}

check_directory() {
    if [ ! -d "$1" ]; then
        log_error "Directory not found: $1"
        exit 1
    fi
}

# =============================================================================
# Pre-flight Checks
# =============================================================================

preflight_checks() {
    log_step "Running pre-flight checks..."
    
    # Check Node.js
    check_command "node"
    NODE_VERSION=$(node -v)
    log_success "Node.js installed: $NODE_VERSION"
    
    # Check npm
    check_command "npm"
    NPM_VERSION=$(npm -v)
    log_success "npm installed: $NPM_VERSION"
    
    # Check required directories
    check_directory "$BACKEND_DIR"
    check_directory "$FRONTEND_DIR/src"
    check_directory "$PRISMA_DIR"
    log_success "All required directories found"
    
    # Check if node_modules exist
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        log_warning "Frontend dependencies not installed. Running npm install..."
        npm install
    fi
    
    if [ ! -d "$BACKEND_DIR/node_modules" ]; then
        log_warning "Backend dependencies not installed. Running npm install in backend..."
        cd "$BACKEND_DIR" && npm install
        cd "$PROJECT_ROOT"
    fi
    
    # Check if concurrently is installed globally or locally
    if ! npm list concurrently &> /dev/null; then
        log_warning "concurrently not found. Installing as dev dependency..."
        npm install --save-dev concurrently
    fi
    
    log_success "Pre-flight checks completed"
}

# =============================================================================
# Database Synchronization
# =============================================================================

sync_database() {
    log_step "Step 1: Syncing Database Schema (Prisma)..."
    
    # Generate Prisma Client
    log_info "Generating Prisma Client..."
    npm run prisma:generate
    
    # Run migrations (development mode)
    log_info "Running database migrations..."
    if ! (cd "$BACKEND_DIR" && npx prisma migrate dev --name sync); then
        log_warning "Prisma migrate dev failed. Falling back to prisma db push for the local development database."
        (cd "$BACKEND_DIR" && npx prisma db push)
    fi
    
    # Seed database if seed file exists
    if [ -f "$PRISMA_DIR/seed.ts" ]; then
        log_info "Seeding database..."
        npm run prisma:seed
    fi
    
    log_success "Database synchronization completed"
}

# =============================================================================
# Cache Clearing
# =============================================================================

clear_cache() {
    log_step "Step 2: Clearing temporary build artifacts..."
    
    # Remove frontend build cache
    if [ -d "$PROJECT_ROOT/dist" ]; then
        rm -rf "$PROJECT_ROOT/dist"
        log_info "Removed frontend dist/"
    fi
    
    # Remove backend build cache
    if [ -d "$BACKEND_DIR/dist" ]; then
        rm -rf "$BACKEND_DIR/dist"
        log_info "Removed backend dist/"
    fi
    
    # Remove Vite cache
    if [ -d "$PROJECT_ROOT/node_modules/.vite" ]; then
        rm -rf "$PROJECT_ROOT/node_modules/.vite"
        log_info "Cleared Vite cache"
    fi
    
    # Remove Prisma cache
    if [ -d "$PRISMA_DIR/.prisma" ]; then
        rm -rf "$PRISMA_DIR/.prisma"
        log_info "Cleared Prisma cache"
    fi
    
    log_success "Cache clearing completed"
}

# =============================================================================
# Health Check
# =============================================================================

run_health_check() {
    log_step "Running health check..."
    
    # Wait for backend to start
    log_info "Waiting for backend to be ready (max 30 seconds)..."
    MAX_ATTEMPTS=30
    ATTEMPT=0
    
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        if curl -s http://localhost:3000/api/health &> /dev/null; then
            HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/health)
            log_success "Backend health check passed: $HEALTH_RESPONSE"
            return 0
        fi
        ATTEMPT=$((ATTEMPT + 1))
        sleep 1
    done
    
    log_error "Backend health check failed after $MAX_ATTEMPTS attempts"
    return 1
}

# =============================================================================
# System Launch
# =============================================================================

launch_system() {
    log_step "Step 3: Launching Backend & Frontend in Watch Mode..."
    echo ""
    echo "============================================================================="
    echo "  FeedFactory Pro Enterprise System"
    echo "  - Backend:  http://localhost:3000"
    echo "  - Frontend: http://localhost:5173"
    echo "  - Health:   http://localhost:3000/api/health"
    echo "============================================================================="
    echo ""
    
    PORT=3000 npm run dev:full
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    echo ""
    echo "============================================================================="
    echo "  🏭 FeedFactory Pro Enterprise System - Master Runner"
    echo "  Version: 2026.03 | Phase 2 Ready (Multi-User & Cloud Sync)"
    echo "============================================================================="
    echo ""
    
    # Parse command line arguments
    case "${1:-full}" in
        "full")
            log_info "Running FULL system startup..."
            preflight_checks
            sync_database
            clear_cache
            launch_system
            ;;
        "no-db")
            log_info "Running system startup WITHOUT database sync..."
            preflight_checks
            clear_cache
            launch_system
            ;;
        "health")
            log_info "Running health check only..."
            run_health_check
            ;;
        "clean")
            log_info "Running cache clean only..."
            clear_cache
            log_success "Cache cleaned successfully"
            ;;
        "help"|"-h"|"--help")
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  full     - Full system startup (default)"
            echo "  no-db    - Start without database sync"
            echo "  health   - Run health check only"
            echo "  clean    - Clean cache only"
            echo "  help     - Show this help message"
            ;;
        *)
            log_error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
