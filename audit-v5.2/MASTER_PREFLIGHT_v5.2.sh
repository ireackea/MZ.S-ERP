#!/bin/bash
# ✅ MASTER_PREFLIGHT_v5.2.sh - Production-Ready Pre-Flight Validation
# Enterprise MZ.S-ERP System - Zero-Blind-Spot Audit Protocol

set -e

echo "🚀 MZ.S-ERP Enterprise Audit v5.2 - Pre-Flight Check"
echo "=================================================="

export REPO_PATH="${REPO_PATH:-/home/runner/work/MZ.S-ERP/MZ.S-ERP}"

# Validate repository exists
if [ ! -d "$REPO_PATH" ]; then
    echo "❌ ERROR: Repository not found at $REPO_PATH"
    echo "   Set REPO_PATH environment variable or place project in expected location"
    exit 1
fi

echo "✅ Repository found: $REPO_PATH"

# Validate Node.js installation
if ! command -v node &>/dev/null; then
    echo "❌ ERROR: Node.js not found"
    echo "   Please install Node.js v18+ to continue"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js installed: $NODE_VERSION"

# Validate npm
if ! command -v npm &>/dev/null; then
    echo "❌ ERROR: npm not found"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo "✅ npm installed: v$NPM_VERSION"

# Change to repository directory
cd "$REPO_PATH" || exit 1
echo "✅ Working directory: $(pwd)"

# Check for package.json files
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: package.json not found in root"
    exit 1
fi
echo "✅ package.json found"

# Check for frontend/backend structure
if [ ! -d "frontend" ] || [ ! -d "backend" ]; then
    echo "⚠️  WARNING: Expected frontend/backend workspace structure not found"
else
    echo "✅ Workspace structure validated (frontend/backend)"
fi

# Check git repository
if [ ! -d ".git" ]; then
    echo "⚠️  WARNING: Not a git repository"
else
    echo "✅ Git repository detected"
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    echo "   Current branch: $CURRENT_BRANCH"
fi

# Create audit output directory
mkdir -p "$REPO_PATH/audit-v5.2/reports"
echo "✅ Audit reports directory: $REPO_PATH/audit-v5.2/reports"

echo ""
echo "=================================================="
echo "✅ PRE-FLIGHT CHECK PASSED"
echo "   Timestamp: $(date -Iseconds)"
echo "   Ready for comprehensive audit execution"
echo "=================================================="

exit 0
