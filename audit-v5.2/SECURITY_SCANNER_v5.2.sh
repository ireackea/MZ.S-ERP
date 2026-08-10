#!/bin/bash
# ✅ SECURITY_SCANNER_v5.2.sh - Production Silent Killer Elimination
# Enterprise Critical Security Vulnerabilities Detection (CVSS 7.0-10.0)

set -e

export REPO_PATH="${REPO_PATH:-/home/runner/work/MZ.S-ERP/MZ.S-ERP}"
cd "$REPO_PATH" || exit 1

echo "💀 STEP 3: Security Vulnerability Detection"
echo "==========================================="

REPORTS_DIR="$REPO_PATH/audit-v5.2/reports"
mkdir -p "$REPORTS_DIR"

CRITICAL_ISSUES=0
HIGH_ISSUES=0
MEDIUM_ISSUES=0

# === CRITICAL: SQL Injection Risks (CVSS 9.0-10.0) ===
echo "🔴 Scanning for SQL injection risks..."
grep -r -n "\$queryRaw\|\$executeRaw\|prisma\.\$queryRawUnsafe\|prisma\.\$executeRawUnsafe" . \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null > "$REPORTS_DIR/critical-sql-injection.txt" || echo "✅ No raw SQL queries detected" > "$REPORTS_DIR/critical-sql-injection.txt"

SQL_INJECTION=$(grep -c ":" "$REPORTS_DIR/critical-sql-injection.txt" 2>/dev/null || echo 0)
if [ "$SQL_INJECTION" -gt 0 ]; then
    echo "   🚨 CRITICAL: Found $SQL_INJECTION potential SQL injection points (raw Prisma queries)"
    CRITICAL_ISSUES=$((CRITICAL_ISSUES + SQL_INJECTION))
else
    echo "   ✅ No SQL injection risks"
fi

# === CRITICAL: Auth Bypass Risks ===
echo "🔴 Scanning for authentication bypass risks..."
grep -r -n "@Public()\|@SkipAuth\|@AllowAnonymous\|bypassAuth" . \
  --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null > "$REPORTS_DIR/critical-auth-bypass.txt" || echo "✅ No public endpoints detected" > "$REPORTS_DIR/critical-auth-bypass.txt"

AUTH_BYPASS=$(grep -c ":" "$REPORTS_DIR/critical-auth-bypass.txt" 2>/dev/null || echo 0)
if [ "$AUTH_BYPASS" -gt 0 ]; then
    echo "   🚨 CRITICAL: Found $AUTH_BYPASS potential auth bypass decorators (review required)"
    CRITICAL_ISSUES=$((CRITICAL_ISSUES + AUTH_BYPASS))
else
    echo "   ✅ No obvious auth bypass"
fi

# === CRITICAL: Memory Leaks (useEffect) ===
echo "🔴 Scanning for React memory leak patterns..."
grep -r -n "useEffect.*\[\]" . \
  --include="*.tsx" --include="*.jsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -50 > "$REPORTS_DIR/critical-memory-leaks.txt" || echo "✅ No obvious memory leak patterns" > "$REPORTS_DIR/critical-memory-leaks.txt"

MEMORY_LEAKS=$(grep -c ":" "$REPORTS_DIR/critical-memory-leaks.txt" 2>/dev/null || echo 0)
if [ "$MEMORY_LEAKS" -gt 0 ]; then
    echo "   🚨 CRITICAL: Found $MEMORY_LEAKS useEffect patterns (potential memory leaks - review cleanup)"
    CRITICAL_ISSUES=$((CRITICAL_ISSUES + MEMORY_LEAKS))
else
    echo "   ✅ No obvious memory leak patterns"
fi

# === CRITICAL: TLS/SSL Certificate Validation Disabled ===
echo "🔴 Scanning for disabled TLS certificate validation..."
grep -r -n "rejectUnauthorized.*false\|verify.*false\|strictSSL.*false" . \
  --include="*.ts" --include="*.js" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null > "$REPORTS_DIR/critical-tls-bypass.txt" || echo "✅ TLS validation enabled" > "$REPORTS_DIR/critical-tls-bypass.txt"

TLS_BYPASS=$(grep -c ":" "$REPORTS_DIR/critical-tls-bypass.txt" 2>/dev/null || echo 0)
if [ "$TLS_BYPASS" -gt 0 ]; then
    echo "   🚨 CRITICAL: Found $TLS_BYPASS TLS certificate validation bypasses (MITM risk)"
    CRITICAL_ISSUES=$((CRITICAL_ISSUES + TLS_BYPASS))
else
    echo "   ✅ TLS validation appears enabled"
fi

# === HIGH: CORS Wildcard (CVSS 7.0-8.9) ===
echo "🟡 Scanning for CORS misconfigurations..."
grep -r -n "cors.*true\|origin.*\*\|credentials.*true" . \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -30 > "$REPORTS_DIR/high-cors-issues.txt" || echo "✅ No obvious CORS issues" > "$REPORTS_DIR/high-cors-issues.txt"

CORS_ISSUES=$(grep -c ":" "$REPORTS_DIR/high-cors-issues.txt" 2>/dev/null || echo 0)
if [ "$CORS_ISSUES" -gt 0 ]; then
    echo "   ⚠️  HIGH: Found $CORS_ISSUES potential CORS misconfigurations"
    HIGH_ISSUES=$((HIGH_ISSUES + CORS_ISSUES))
else
    echo "   ✅ CORS configuration looks reasonable"
fi

# === HIGH: Race Conditions (Sequential Awaits) ===
echo "🟡 Scanning for race condition patterns..."
grep -r -n -A1 "await" . \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | grep -B1 "await" | head -30 > "$REPORTS_DIR/high-race-conditions.txt" || echo "✅ No obvious race conditions" > "$REPORTS_DIR/high-race-conditions.txt"

RACE_CONDITIONS=$(grep -c "await" "$REPORTS_DIR/high-race-conditions.txt" 2>/dev/null || echo 0)
if [ "$RACE_CONDITIONS" -gt 5 ]; then
    echo "   ⚠️  HIGH: Found $RACE_CONDITIONS sequential await patterns (review for race conditions)"
    HIGH_ISSUES=$((HIGH_ISSUES + 1))
else
    echo "   ✅ Minimal sequential await patterns"
fi

# === HIGH: Socket.IO Security ===
echo "🟡 Scanning Socket.IO security patterns..."
grep -r -n "socket\.on\|io\.on\|@SubscribeMessage" . \
  --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -50 > "$REPORTS_DIR/high-socketio-handlers.txt" || echo "✅ No Socket.IO handlers found" > "$REPORTS_DIR/high-socketio-handlers.txt"

SOCKET_HANDLERS=$(grep -c ":" "$REPORTS_DIR/high-socketio-handlers.txt" 2>/dev/null || echo 0)
if [ "$SOCKET_HANDLERS" -gt 0 ]; then
    echo "   ⚠️  HIGH: Found $SOCKET_HANDLERS Socket.IO event handlers (verify auth & input sanitization)"
    HIGH_ISSUES=$((HIGH_ISSUES + 1))
else
    echo "   ✅ No Socket.IO handlers detected"
fi

# === MEDIUM: JWT & Crypto Issues ===
echo "🟢 Scanning for cryptographic issues..."
grep -r -n "jwt\.sign\|bcrypt\|crypto\|md5\|sha1" . \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | grep -v "sha256\|sha512" | head -30 > "$REPORTS_DIR/medium-crypto-usage.txt" || echo "✅ No weak crypto detected" > "$REPORTS_DIR/medium-crypto-usage.txt"

CRYPTO_ISSUES=$(grep -c -i "md5\|sha1" "$REPORTS_DIR/medium-crypto-usage.txt" 2>/dev/null || echo 0)
if [ "$CRYPTO_ISSUES" -gt 0 ]; then
    echo "   ℹ️  MEDIUM: Found $CRYPTO_ISSUES weak hash algorithms (MD5/SHA1)"
    MEDIUM_ISSUES=$((MEDIUM_ISSUES + CRYPTO_ISSUES))
else
    echo "   ✅ No weak crypto algorithms detected"
fi

# === MEDIUM: Environment Variable Usage ===
echo "🟢 Scanning for environment variable best practices..."
grep -r -n "process\.env\." . \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -50 > "$REPORTS_DIR/medium-env-vars.txt" || echo "✅ Minimal env var usage" > "$REPORTS_DIR/medium-env-vars.txt"

ENV_VAR_COUNT=$(grep -c ":" "$REPORTS_DIR/medium-env-vars.txt" 2>/dev/null || echo 0)
echo "   ℹ️  Found $ENV_VAR_COUNT environment variable usages (verify defaults & validation)"

# === Summary ===
echo ""
echo "==========================================="
echo "🔒 SECURITY SCAN SUMMARY"
echo "==========================================="
echo "   🔴 CRITICAL Issues: $CRITICAL_ISSUES"
echo "   🟡 HIGH Issues: $HIGH_ISSUES"
echo "   🟢 MEDIUM Issues: $MEDIUM_ISSUES"
echo ""

if [ "$CRITICAL_ISSUES" -gt 0 ]; then
    echo "   🚨 PRODUCTION BLOCKER: Fix critical issues before deployment!"
elif [ "$HIGH_ISSUES" -gt 5 ]; then
    echo "   ⚠️  PRODUCTION WARNING: Review high-risk issues"
else
    echo "   ✅ Security posture acceptable for production"
fi

echo ""
echo "📄 Security reports in: $REPORTS_DIR/"

exit 0
