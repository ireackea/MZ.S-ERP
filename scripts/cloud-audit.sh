#!/bin/bash

# =============================================================================
# SURGICAL CLOUD AUDIT: FeedFactory Pro ERP System
# Version: 2026.03 - GitHub Codespaces Edition
# Protocol: Surgical Cloud Audit (SCA-v1)
# =============================================================================
# Usage:
#   bash scripts/cloud-audit.sh [--backend-url URL] [--frontend-url URL]
#   In Codespaces, URLs are inferred from CODESPACE_NAME automatically.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()      { echo -e "${GREEN}[PASS]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_fail()    { echo -e "${RED}[FAIL]${NC}  $1"; }
log_section() { echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${NC}"; }

# ---------------------------------------------------------------------------
# Resolve URLs
# ---------------------------------------------------------------------------
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if [ -n "${CODESPACE_NAME:-}" ]; then
    CS_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
    DEFAULT_BACKEND_URL="https://${CODESPACE_NAME}-${BACKEND_PORT}.${CS_DOMAIN}"
    DEFAULT_FRONTEND_URL="https://${CODESPACE_NAME}-${FRONTEND_PORT}.${CS_DOMAIN}"
else
    DEFAULT_BACKEND_URL="http://localhost:${BACKEND_PORT}"
    DEFAULT_FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
fi

BACKEND_URL="${BACKEND_URL:-$DEFAULT_BACKEND_URL}"
FRONTEND_URL="${FRONTEND_URL:-$DEFAULT_FRONTEND_URL}"

# Parse optional CLI overrides
while [[ $# -gt 0 ]]; do
    case $1 in
        --backend-url)  BACKEND_URL="$2";  shift 2 ;;
        --frontend-url) FRONTEND_URL="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# ---------------------------------------------------------------------------
# Audit result tracking
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); log_ok  "$1"; }
record_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); log_fail "$1"; }
record_warn() { WARN_COUNT=$((WARN_COUNT + 1)); log_warn "$1"; }

http_get() {
    curl -sk --max-time 10 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"
}

http_body() {
    curl -sk --max-time 10 "$1" 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# PHASE 1 — System Reachability
# ---------------------------------------------------------------------------
audit_reachability() {
    log_section "PHASE 1: System Reachability"

    BACKEND_HEALTH_CODE=$(http_get "${BACKEND_URL}/api/health")
    if [ "$BACKEND_HEALTH_CODE" = "200" ]; then
        record_pass "Backend reachable at ${BACKEND_URL}/api/health (HTTP 200)"
    else
        record_fail "Backend NOT reachable at ${BACKEND_URL}/api/health (HTTP ${BACKEND_HEALTH_CODE})"
    fi

    FRONTEND_CODE=$(http_get "${FRONTEND_URL}")
    if [ "$FRONTEND_CODE" = "200" ] || [ "$FRONTEND_CODE" = "304" ]; then
        record_pass "Frontend reachable at ${FRONTEND_URL} (HTTP ${FRONTEND_CODE})"
    else
        record_warn "Frontend returned HTTP ${FRONTEND_CODE} at ${FRONTEND_URL}"
    fi

    HEALTH_BODY=$(http_body "${BACKEND_URL}/api/health")
    if echo "$HEALTH_BODY" | grep -q '"status"'; then
        record_pass "Backend health response contains 'status' field"
    else
        record_warn "Backend health response missing 'status' field: ${HEALTH_BODY}"
    fi
}

# ---------------------------------------------------------------------------
# PHASE 2 — Authentication Audit
# ---------------------------------------------------------------------------
audit_authentication() {
    log_section "PHASE 2: Authentication Audit"

    # 2a. Unauthenticated access to protected endpoint must be blocked
    UNAUTH_CODE=$(http_get "${BACKEND_URL}/api/users")
    if [ "$UNAUTH_CODE" = "401" ] || [ "$UNAUTH_CODE" = "403" ]; then
        record_pass "Protected endpoint /api/users blocks unauthenticated requests (HTTP ${UNAUTH_CODE})"
    else
        record_fail "Protected endpoint /api/users returned HTTP ${UNAUTH_CODE} without auth (expected 401/403)"
    fi

    # 2b. Login with wrong credentials must be rejected
    BAD_LOGIN=$(curl -sk --max-time 10 -o /dev/null -w "%{http_code}" \
        -X POST "${BACKEND_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"baduser","password":"badpass"}' 2>/dev/null || echo "000")
    if [ "$BAD_LOGIN" = "401" ] || [ "$BAD_LOGIN" = "400" ]; then
        record_pass "Login rejects invalid credentials (HTTP ${BAD_LOGIN})"
    else
        record_fail "Login returned unexpected HTTP ${BAD_LOGIN} for invalid credentials"
    fi

    # 2c. Check CORS header on health endpoint
    CORS_HEADER=$(curl -sk --max-time 10 -I \
        -H "Origin: https://evil.example.com" \
        "${BACKEND_URL}/api/health" 2>/dev/null \
        | grep -i "access-control-allow-origin" | tr -d '\r\n' || true)
    if echo "$CORS_HEADER" | grep -qi "evil.example.com"; then
        record_fail "CORS misconfiguration: backend allows arbitrary origin (evil.example.com)"
    else
        record_pass "CORS correctly blocks arbitrary origins"
    fi

    # 2d. Rate limiting header present
    RATE_HEADER=$(curl -sk --max-time 10 -I "${BACKEND_URL}/api/health" 2>/dev/null \
        | grep -i "x-ratelimit-limit" | tr -d '\r\n' || true)
    if [ -n "$RATE_HEADER" ]; then
        record_pass "Rate-limit header present: ${RATE_HEADER}"
    else
        record_warn "Rate-limit header (X-RateLimit-Limit) not found on /api/health"
    fi
}

# ---------------------------------------------------------------------------
# PHASE 3 — API Stress Test (light burst)
# ---------------------------------------------------------------------------
audit_stress() {
    log_section "PHASE 3: API Stress Test (20 concurrent requests)"

    STRESS_PASS=0
    STRESS_FAIL=0
    PIDS=()
    RESULTS_DIR=$(mktemp -d)

    for i in $(seq 1 20); do
        (
            CODE=$(http_get "${BACKEND_URL}/api/health")
            echo "$CODE" > "${RESULTS_DIR}/${i}.txt"
        ) &
        PIDS+=($!)
    done

    for pid in "${PIDS[@]}"; do
        wait "$pid" 2>/dev/null || true
    done

    for f in "${RESULTS_DIR}"/*.txt; do
        CODE=$(cat "$f")
        if [ "$CODE" = "200" ]; then
            STRESS_PASS=$((STRESS_PASS + 1))
        else
            STRESS_FAIL=$((STRESS_FAIL + 1))
        fi
    done
    rm -rf "$RESULTS_DIR"

    if [ "$STRESS_FAIL" -eq 0 ]; then
        record_pass "Stress test: all 20 requests returned HTTP 200 (${STRESS_PASS}/20)"
    elif [ "$STRESS_FAIL" -le 2 ]; then
        record_warn "Stress test: ${STRESS_FAIL}/20 requests failed (${STRESS_PASS} passed)"
    else
        record_fail "Stress test: ${STRESS_FAIL}/20 requests failed (${STRESS_PASS} passed)"
    fi
}

# ---------------------------------------------------------------------------
# PHASE 4 — Offline-First & PWA Checks
# ---------------------------------------------------------------------------
audit_offline() {
    log_section "PHASE 4: Offline-First & PWA Checks"

    # Check service worker registration script in frontend
    FRONTEND_BODY=$(http_body "${FRONTEND_URL}" 2>/dev/null || echo "")

    if echo "$FRONTEND_BODY" | grep -qi "serviceWorker\|service-worker\|sw\.js"; then
        record_pass "Frontend references Service Worker"
    else
        record_warn "No Service Worker reference detected in frontend HTML"
    fi

    # Check Dexie/IndexedDB references exist in built assets
    PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    DEXIE_REF=$(grep -rl "dexie\|Dexie\|indexeddb\|IndexedDB" \
        "${PROJECT_ROOT}/frontend/src" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | xargs || echo "0")
    if [ "${DEXIE_REF:-0}" -gt 0 ] 2>/dev/null; then
        record_pass "Dexie/IndexedDB usage found in frontend source (${DEXIE_REF} file(s))"
    else
        record_warn "No Dexie/IndexedDB usage detected in frontend/src"
    fi

    # Check Zustand state management
    ZUSTAND_REF=$(grep -rl "zustand\|create(" \
        "${PROJECT_ROOT}/frontend/src" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | xargs || echo "0")
    if [ "${ZUSTAND_REF:-0}" -gt 0 ] 2>/dev/null; then
        record_pass "Zustand state management found in frontend source (${ZUSTAND_REF} file(s))"
    else
        record_warn "No Zustand usage detected in frontend/src"
    fi
}

# ---------------------------------------------------------------------------
# PHASE 5 — Security Headers
# ---------------------------------------------------------------------------
audit_security_headers() {
    log_section "PHASE 5: Security Headers"

    HEADERS=$(curl -sk --max-time 10 -I "${BACKEND_URL}/api/health" 2>/dev/null || echo "")

    check_header() {
        local name="$1"
        if echo "$HEADERS" | grep -qi "^${name}:"; then
            record_pass "Security header present: ${name}"
        else
            record_warn "Security header missing: ${name}"
        fi
    }

    check_header "X-Content-Type-Options"
    check_header "X-Frame-Options"
    check_header "Strict-Transport-Security"

    # Ensure server version is not leaked
    SERVER_HEADER=$(echo "$HEADERS" | grep -i "^X-Powered-By:" | tr -d '\r\n' || true)
    if [ -n "$SERVER_HEADER" ]; then
        record_warn "X-Powered-By header leaks server info: ${SERVER_HEADER}"
    else
        record_pass "X-Powered-By header not exposed"
    fi
}

# ---------------------------------------------------------------------------
# PHASE 6 — WebSocket / Realtime
# ---------------------------------------------------------------------------
audit_realtime() {
    log_section "PHASE 6: Realtime / WebSocket Check"

    PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    WS_REF=$(grep -rl "socket\.io\|WebSocket\|RealtimeModule" \
        "${PROJECT_ROOT}/backend/src" --include="*.ts" 2>/dev/null | wc -l | xargs || echo "0")
    if [ "${WS_REF:-0}" -gt 0 ] 2>/dev/null; then
        record_pass "WebSocket/Socket.IO implementation found in backend (${WS_REF} file(s))"
    else
        record_warn "No WebSocket/Socket.IO implementation detected in backend/src"
    fi
}

# ---------------------------------------------------------------------------
# Generate Audit Report
# ---------------------------------------------------------------------------
generate_report() {
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    DATE_HUMAN=$(date -u +"%Y-%m-%d %H:%M UTC")
    TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))
    if [ "$TOTAL" -gt 0 ]; then
        SCORE=$((PASS_COUNT * 100 / TOTAL))
    else
        SCORE=0
    fi

    if [ -n "${CODESPACE_NAME:-}" ]; then
        ENV_LINE="GitHub Codespaces — \`${CODESPACE_NAME}\`"
    else
        ENV_LINE="Local / CI Environment"
    fi

    REPORT_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/CODESPACE_SYSTEM_AUDIT_REPORT_AR.md"

    # Build recommendations section conditionally
    RECOMMENDATIONS=""
    if [ "$FAIL_COUNT" -gt 0 ]; then
        RECOMMENDATIONS="${RECOMMENDATIONS}- ⚠️ **عاجل:** يوجد ${FAIL_COUNT} فشل يتطلب معالجة فورية (تأكد من تشغيل النظام أولًا).\n"
    else
        RECOMMENDATIONS="${RECOMMENDATIONS}- ✅ لا توجد إخفاقات حرجة.\n"
    fi
    if [ "$WARN_COUNT" -gt 0 ]; then
        RECOMMENDATIONS="${RECOMMENDATIONS}- 🔧 يوجد ${WARN_COUNT} تحذير يُنصح بمراجعته.\n"
    else
        RECOMMENDATIONS="${RECOMMENDATIONS}- ✅ لا توجد تحذيرات.\n"
    fi
    RECOMMENDATIONS="${RECOMMENDATIONS}- تفعيل رؤوس الأمان المفقودة على مستوى Nginx أو تطبيق NestJS.\n"
    RECOMMENDATIONS="${RECOMMENDATIONS}- مراجعة تكوين CORS بصفة دورية عند إضافة بيئات جديدة.\n"
    RECOMMENDATIONS="${RECOMMENDATIONS}- اختبار سيناريو انقطاع الشبكة للتحقق من سلوك Offline-First فعليًا في المتصفح."

    cat > "$REPORT_FILE" << MDEOF
# تقرير التدقيق السحابي الجراحي — FeedFactory Pro ERP
**بروتوكول:** Surgical Cloud Audit (SCA-v1)
**التاريخ:** ${DATE_HUMAN}
**البيئة:** ${ENV_LINE}
**الخادم الخلفي:** \`${BACKEND_URL}\`
**الواجهة الأمامية:** \`${FRONTEND_URL}\`

---

## ملخص النتائج

| المعيار | القيمة |
|---------|--------|
| ✅ اجتاز | **${PASS_COUNT}** |
| ⚠️ تحذير | **${WARN_COUNT}** |
| ❌ فشل | **${FAIL_COUNT}** |
| **المجموع** | **${TOTAL}** |
| **نسبة النجاح** | **${SCORE}%** |

---

## المراحل المُنفَّذة

### المرحلة 1 — إمكانية الوصول إلى النظام
- فحص نقطة نهاية الصحة للخادم الخلفي \`/api/health\`
- فحص إمكانية الوصول إلى الواجهة الأمامية
- التحقق من بنية استجابة الصحة

### المرحلة 2 — تدقيق المصادقة
- التحقق من حجب الطلبات غير المصادق عليها على نقاط النهاية المحمية
- اختبار رفض بيانات اعتماد تسجيل الدخول غير الصحيحة
- فحص تكوين CORS ضد الأصول العشوائية
- التحقق من وجود رؤوس تحديد المعدل (Rate Limiting)

### المرحلة 3 — اختبار الإجهاد
- إرسال 20 طلبًا متزامنًا إلى نقطة نهاية الصحة
- قياس معدل نجاح الطلبات

### المرحلة 4 — فحوصات Offline-First ومتطلبات PWA
- التحقق من وجود مرجع Service Worker في الواجهة الأمامية
- فحص استخدام Dexie/IndexedDB في مصادر الواجهة الأمامية
- فحص استخدام Zustand لإدارة الحالة

### المرحلة 5 — رؤوس الأمان
- \`X-Content-Type-Options\`
- \`X-Frame-Options\`
- \`Strict-Transport-Security\`
- إخفاء رأس \`X-Powered-By\`

### المرحلة 6 — الاتصال الفوري / WebSocket
- التحقق من تطبيق Socket.IO/WebSocket في الخادم الخلفي

---

## التفاصيل التقنية

| المكوّن | التقنية |
|--------|---------|
| الواجهة الأمامية | React 18 + Vite + TypeScript + TailwindCSS |
| الخادم الخلفي | NestJS + Express + Socket.IO |
| قاعدة البيانات | SQLite (Prisma ORM) |
| المصادقة | JWT + RBAC |
| الحالة المحلية | Zustand |
| قاعدة البيانات المحلية | Dexie.js (IndexedDB) |
| التقارير | Puppeteer (PDF) + ExcelJS |

---

## التوصيات

$(printf '%b' "$RECOMMENDATIONS")

---

*تم إنشاء هذا التقرير تلقائيًا بواسطة بروتوكول SCA-v1 | ${TIMESTAMP}*
MDEOF

    echo ""
    echo "============================================================================="
    echo -e "  ${BOLD}📊 نتائج التدقيق السحابي الجراحي${NC}"
    echo "  اجتاز: ${PASS_COUNT}  |  تحذير: ${WARN_COUNT}  |  فشل: ${FAIL_COUNT}"
    echo "  نسبة النجاح: ${SCORE}%"
    echo "  التقرير: ${REPORT_FILE}"
    echo "============================================================================="

    if [ "$FAIL_COUNT" -gt 0 ]; then
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo -e "  ${CYAN}${BOLD}🔬 FeedFactory Pro — Surgical Cloud Audit (SCA-v1)${NC}"
echo "  Backend:  ${BACKEND_URL}"
echo "  Frontend: ${FRONTEND_URL}"
echo "============================================================================="

audit_reachability
audit_authentication
audit_stress
audit_offline
audit_realtime
audit_security_headers
generate_report
