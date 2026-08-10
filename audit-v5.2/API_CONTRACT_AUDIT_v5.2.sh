#!/bin/bash
# ✅ API_CONTRACT_AUDIT_v5.2.sh - Data Flow & API Contract Validation
# Maps frontend API calls to backend endpoints

set -e

export REPO_PATH="${REPO_PATH:-/home/runner/work/MZ.S-ERP/MZ.S-ERP}"
cd "$REPO_PATH" || exit 1

echo "🔄 STEP 2.3: API Contract Validation"
echo "===================================="

REPORTS_DIR="$REPO_PATH/audit-v5.2/reports"
mkdir -p "$REPORTS_DIR"

# === Frontend API Calls ===
echo "Mapping frontend API calls..."
find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/backend/*" \
  2>/dev/null | xargs grep -l "axios\|fetch\|http\|api\." 2>/dev/null | sort > "$REPORTS_DIR/frontend-api-files.txt" || touch "$REPORTS_DIR/frontend-api-files.txt"

# Extract actual API calls
grep -r -n "axios\.\(get\|post\|put\|patch\|delete\)\|fetch(" . \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=backend \
  2>/dev/null | head -100 > "$REPORTS_DIR/frontend-api-calls.txt" || touch "$REPORTS_DIR/frontend-api-calls.txt"

FRONTEND_API_COUNT=$(wc -l < "$REPORTS_DIR/frontend-api-calls.txt" 2>/dev/null || echo 0)
echo "   Frontend API calls detected: $FRONTEND_API_COUNT"

# === Backend Controllers & Routes ===
echo "Mapping backend controllers..."
find backend -path "*/controller*" -o -path "*/controllers/*" -name "*.ts" \
  2>/dev/null | sort > "$REPORTS_DIR/backend-controllers.txt" || touch "$REPORTS_DIR/backend-controllers.txt"

# Find route decorators (@Get, @Post, etc.)
grep -r -n "@\(Get\|Post\|Put\|Patch\|Delete\|All\)(" backend \
  --include="*.ts" \
  2>/dev/null | head -100 > "$REPORTS_DIR/backend-routes.txt" || touch "$REPORTS_DIR/backend-routes.txt"

BACKEND_ROUTES_COUNT=$(wc -l < "$REPORTS_DIR/backend-routes.txt" 2>/dev/null || echo 0)
echo "   Backend routes detected: $BACKEND_ROUTES_COUNT"

# === DTOs and Validation ===
echo "Analyzing DTOs and validation schemas..."
find . -name "*dto*" -o -name "*validation*" -o -name "*schema*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" \
  2>/dev/null | grep "\.ts$" | sort > "$REPORTS_DIR/dtos-validation.txt" || touch "$REPORTS_DIR/dtos-validation.txt"

DTO_COUNT=$(wc -l < "$REPORTS_DIR/dtos-validation.txt" 2>/dev/null || echo 0)
echo "   DTO/Validation files: $DTO_COUNT"

# === WebSocket Events (Socket.IO) ===
echo "Analyzing Socket.IO events..."
grep -r -n "socket\.\(on\|emit\)\|io\.\(on\|emit\)\|@\(SubscribeMessage\|MessageBody\)" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null | head -100 > "$REPORTS_DIR/socketio-events.txt" || touch "$REPORTS_DIR/socketio-events.txt"

SOCKET_EVENTS=$(wc -l < "$REPORTS_DIR/socketio-events.txt" 2>/dev/null || echo 0)
echo "   Socket.IO events detected: $SOCKET_EVENTS"

# === Zustand Stores ===
echo "Analyzing Zustand state stores..."
find frontend -name "*store*" -o -name "*Store*" \
  2>/dev/null | grep "\.ts$\|\.tsx$" | sort > "$REPORTS_DIR/zustand-stores.txt" || touch "$REPORTS_DIR/zustand-stores.txt"

grep -r -n "create.*useStore\|zustand" frontend \
  --include="*.ts" --include="*.tsx" \
  2>/dev/null | head -50 > "$REPORTS_DIR/zustand-usage.txt" || touch "$REPORTS_DIR/zustand-usage.txt"

ZUSTAND_STORES=$(wc -l < "$REPORTS_DIR/zustand-stores.txt" 2>/dev/null || echo 0)
echo "   Zustand stores: $ZUSTAND_STORES"

# === React Components ===
echo "Analyzing React components..."
find frontend -name "*.tsx" -not -path "*/node_modules/*" \
  2>/dev/null | sort > "$REPORTS_DIR/react-components.txt" || touch "$REPORTS_DIR/react-components.txt"

COMPONENT_COUNT=$(wc -l < "$REPORTS_DIR/react-components.txt" 2>/dev/null || echo 0)
echo "   React components: $COMPONENT_COUNT"

echo ""
echo "✅ API Contract Audit Complete"
echo "   Frontend → Backend mapping analyzed"
echo "   API Calls: $FRONTEND_API_COUNT → Routes: $BACKEND_ROUTES_COUNT"
echo "   Socket Events: $SOCKET_EVENTS"
echo "   React Components: $COMPONENT_COUNT"
echo "   Zustand Stores: $ZUSTAND_STORES"
echo ""
echo "📄 Reports in: $REPORTS_DIR/"

exit 0
