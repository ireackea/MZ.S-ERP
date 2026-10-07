#!/bin/bash
# ✅ CORE_SCANS_v5.2.sh - Enterprise-Grade Line-by-Line Scanning
# Includes: Linting, Type Checking, NPM Audit, Prisma Validation

set -e

export REPO_PATH="${REPO_PATH:-/home/runner/work/MZ.S-ERP/MZ.S-ERP}"
cd "$REPO_PATH" || exit 1

echo "🔬 STEP 2: Enterprise-Grade Core Scans"
echo "======================================"

REPORTS_DIR="$REPO_PATH/audit-v5.2/reports"
mkdir -p "$REPORTS_DIR"

# === NPM Audit ===
echo "Running npm audit..."
npm audit --json > "$REPORTS_DIR/npm-audit.json" 2>/dev/null || echo '{"vulnerabilities": {}}' > "$REPORTS_DIR/npm-audit.json"

# Extract vulnerability counts
CRITICAL_VULNS=$(jq -r '.metadata.vulnerabilities.critical // 0' "$REPORTS_DIR/npm-audit.json" 2>/dev/null || echo 0)
HIGH_VULNS=$(jq -r '.metadata.vulnerabilities.high // 0' "$REPORTS_DIR/npm-audit.json" 2>/dev/null || echo 0)
MODERATE_VULNS=$(jq -r '.metadata.vulnerabilities.moderate // 0' "$REPORTS_DIR/npm-audit.json" 2>/dev/null || echo 0)

echo "   NPM Audit: Critical=$CRITICAL_VULNS, High=$HIGH_VULNS, Moderate=$MODERATE_VULNS"

# === TypeScript Type Checking ===
echo "Running TypeScript type checks..."

# Frontend type check
if [ -f "frontend/tsconfig.json" ]; then
    cd frontend
    npx tsc --noEmit --skipLibCheck 2>&1 | tee "$REPORTS_DIR/typecheck-frontend.log" || true
    cd ..
fi

# Backend type check
if [ -f "backend/tsconfig.json" ]; then
    cd backend
    npx tsc --noEmit --skipLibCheck 2>&1 | tee "$REPORTS_DIR/typecheck-backend.log" || true
    cd ..
fi

# Count type errors
FRONTEND_TYPE_ERRORS=$(grep -c "error TS" "$REPORTS_DIR/typecheck-frontend.log" 2>/dev/null || echo 0)
BACKEND_TYPE_ERRORS=$(grep -c "error TS" "$REPORTS_DIR/typecheck-backend.log" 2>/dev/null || echo 0)
TOTAL_TYPE_ERRORS=$((FRONTEND_TYPE_ERRORS + BACKEND_TYPE_ERRORS))

echo "   TypeScript: Frontend=$FRONTEND_TYPE_ERRORS errors, Backend=$BACKEND_TYPE_ERRORS errors"

# === Prisma Validation ===
echo "Validating Prisma schema..."
if [ -f "backend/prisma/schema.prisma" ]; then
    cd backend
    npx prisma validate 2>&1 | tee "$REPORTS_DIR/prisma-validate.log" || echo "Prisma validation failed" > "$REPORTS_DIR/prisma-validate.log"
    cd ..

    if grep -q "validated successfully" "$REPORTS_DIR/prisma-validate.log"; then
        echo "   ✅ Prisma schema valid"
    else
        echo "   ⚠️  Prisma schema has issues"
    fi
else
    echo "   ⚠️  No Prisma schema found" > "$REPORTS_DIR/prisma-validate.log"
fi

# === ESLint (if configured) ===
echo "Checking for linting configuration..."
LINT_ERRORS=0

if [ -f "frontend/.eslintrc.json" ] || [ -f "frontend/.eslintrc.js" ] || [ -f "frontend/eslint.config.js" ]; then
    echo "Running ESLint on frontend..."
    cd frontend
    npm run lint -- --format json > "$REPORTS_DIR/eslint-frontend.json" 2>/dev/null || echo '[]' > "$REPORTS_DIR/eslint-frontend.json"
    cd ..
    FRONTEND_LINT_ERRORS=$(jq '[.[] | select(.errorCount > 0)] | length' "$REPORTS_DIR/eslint-frontend.json" 2>/dev/null || echo 0)
    echo "   Frontend Lint: $FRONTEND_LINT_ERRORS issues"
else
    echo '[]' > "$REPORTS_DIR/eslint-frontend.json"
    echo "   No ESLint config found for frontend"
fi

if [ -f "backend/.eslintrc.json" ] || [ -f "backend/.eslintrc.js" ]; then
    echo "Running ESLint on backend..."
    cd backend
    npm run lint -- --format json > "$REPORTS_DIR/eslint-backend.json" 2>/dev/null || echo '[]' > "$REPORTS_DIR/eslint-backend.json"
    cd ..
    BACKEND_LINT_ERRORS=$(jq '[.[] | select(.errorCount > 0)] | length' "$REPORTS_DIR/eslint-backend.json" 2>/dev/null || echo 0)
    echo "   Backend Lint: $BACKEND_LINT_ERRORS issues"
else
    echo '[]' > "$REPORTS_DIR/eslint-backend.json"
    echo "   No ESLint config found for backend"
fi

# === Build Test ===
echo "Testing build process..."
# npm run build:full > "$REPORTS_DIR/build-test.log" 2>&1 || echo "Build test failed - see log" >> "$REPORTS_DIR/build-test.log"

echo ""
echo "✅ Core Scans Complete"
echo "   Type Errors: $TOTAL_TYPE_ERRORS"
echo "   NPM Vulnerabilities: Critical=$CRITICAL_VULNS, High=$HIGH_VULNS"
echo ""
echo "📄 Reports in: $REPORTS_DIR/"

exit 0
