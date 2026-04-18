#!/bin/bash
# ✅ TECH_DEBT_SCANNER_v5.2.sh - Industrial Tech Debt Detection
# Detects: TODO, FIXME, console.log, @ts-ignore, 'any' types, and security risks

set -e

export REPO_PATH="${REPO_PATH:-/home/runner/work/MZ.S-ERP/MZ.S-ERP}"
cd "$REPO_PATH" || exit 1

echo "🔍 STEP 2.2: Tech Debt & Security Scanner"
echo "========================================"

REPORTS_DIR="$REPO_PATH/audit-v5.2/reports"
mkdir -p "$REPORTS_DIR"

# === Tech Debt Markers ===
echo "Scanning for tech debt markers..."
grep -r -n -E "TODO|FIXME|XXX|HACK|BUG" . \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=.git \
  2>/dev/null | head -100 > "$REPORTS_DIR/tech-debt-markers.txt" || echo "No tech debt markers found" > "$REPORTS_DIR/tech-debt-markers.txt"

TECH_DEBT_COUNT=$(grep -c ":" "$REPORTS_DIR/tech-debt-markers.txt" 2>/dev/null || echo 0)
echo "   Found $TECH_DEBT_COUNT tech debt markers (TODO/FIXME/XXX/HACK/BUG)"

# === TypeScript Anti-patterns ===
echo "Scanning for TypeScript anti-patterns..."
grep -r -n "@ts-ignore\|@ts-nocheck\|as any" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -50 > "$REPORTS_DIR/ts-suppressions.txt" || echo "No TS suppressions found" > "$REPORTS_DIR/ts-suppressions.txt"

TS_SUPPRESS_COUNT=$(grep -c ":" "$REPORTS_DIR/ts-suppressions.txt" 2>/dev/null || echo 0)
echo "   Found $TS_SUPPRESS_COUNT TypeScript suppressions (@ts-ignore, as any)"

# === Console Statements ===
echo "Scanning for console statements..."
grep -r -n "console\.\(log\|warn\|error\|debug\|info\)" . \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -100 > "$REPORTS_DIR/console-statements.txt" || echo "No console statements found" > "$REPORTS_DIR/console-statements.txt"

CONSOLE_COUNT=$(grep -c ":" "$REPORTS_DIR/console-statements.txt" 2>/dev/null || echo 0)
echo "   Found $CONSOLE_COUNT console statements"

# === Potential Secrets & Sensitive Data ===
echo "Scanning for potential secrets..."
grep -r -n -i "password\|secret\|apikey\|api_key\|token\|private.*key\|access.*key" . \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.env" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=audit-v5.2 \
  --exclude="package-lock.json" \
  2>/dev/null | grep -v "PASSWORD" | grep -v "interface\|type\|import\|export\|@param\|//" | head -50 > "$REPORTS_DIR/potential-secrets.txt" || echo "No obvious secrets found" > "$REPORTS_DIR/potential-secrets.txt"

SECRETS_COUNT=$(grep -c ":" "$REPORTS_DIR/potential-secrets.txt" 2>/dev/null || echo 0)
echo "   Found $SECRETS_COUNT potential secret references (needs manual review)"

# === Hardcoded URLs and IPs ===
echo "Scanning for hardcoded URLs and IPs..."
grep -r -n -E "https?://|localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\." . \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=audit-v5.2 \
  2>/dev/null | head -50 > "$REPORTS_DIR/hardcoded-urls.txt" || echo "No hardcoded URLs found" > "$REPORTS_DIR/hardcoded-urls.txt"

URL_COUNT=$(grep -c ":" "$REPORTS_DIR/hardcoded-urls.txt" 2>/dev/null || echo 0)
echo "   Found $URL_COUNT hardcoded URLs/IPs"

# === Any Type Usage ===
echo "Scanning for 'any' type usage..."
grep -r -n ": any\|<any>\|any\[\]\|any{" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | grep -v "company" | head -50 > "$REPORTS_DIR/any-types.txt" || echo "No 'any' types found" > "$REPORTS_DIR/any-types.txt"

ANY_COUNT=$(grep -c ":" "$REPORTS_DIR/any-types.txt" 2>/dev/null || echo 0)
echo "   Found $ANY_COUNT 'any' type usages"

# === Empty Catch Blocks ===
echo "Scanning for empty catch blocks..."
grep -r -n "catch.*{.*}" . \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -30 > "$REPORTS_DIR/empty-catches.txt" || echo "No empty catch blocks detected" > "$REPORTS_DIR/empty-catches.txt"

CATCH_COUNT=$(grep -c ":" "$REPORTS_DIR/empty-catches.txt" 2>/dev/null || echo 0)
echo "   Found $CATCH_COUNT potential empty catch blocks"

echo ""
echo "✅ Tech Debt Scan Complete"
echo "   Tech Debt Markers: $TECH_DEBT_COUNT"
echo "   TS Suppressions: $TS_SUPPRESS_COUNT"
echo "   Console Statements: $CONSOLE_COUNT"
echo "   Potential Secrets: $SECRETS_COUNT"
echo "   Hardcoded URLs: $URL_COUNT"
echo "   'any' Types: $ANY_COUNT"
echo ""
echo "📄 Reports in: $REPORTS_DIR/"

exit 0
