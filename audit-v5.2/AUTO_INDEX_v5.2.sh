#!/bin/bash
# ✅ AUTO_INDEX_v5.2.sh - Full Spectrum Auto-Indexing Engine
# Generates comprehensive inventory metrics in JSON format

set -e

export REPO_PATH="${REPO_PATH:-/home/runner/work/MZ.S-ERP/MZ.S-ERP}"
cd "$REPO_PATH" || exit 1

echo "📊 STEP 1: Full Spectrum Auto-Indexing"
echo "======================================"

REPORTS_DIR="$REPO_PATH/audit-v5.2/reports"
mkdir -p "$REPORTS_DIR"

# Count total files (excluding .git and node_modules)
TOTAL_FILES=$(git ls-files 2>/dev/null | wc -l || find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l)

# Count source files
TS_FILES=$(find . -name "*.ts" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | wc -l)
TSX_FILES=$(find . -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | wc -l)
JS_FILES=$(find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | wc -l)
PRISMA_FILES=$(find . -name "*.prisma" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | wc -l)
JSON_FILES=$(find . -name "*.json" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | wc -l)

SOURCE_FILES=$((TS_FILES + TSX_FILES + JS_FILES + PRISMA_FILES + JSON_FILES))

# Count by category
FRONTEND_FILES=$(find frontend -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" 2>/dev/null | wc -l || echo 0)
BACKEND_FILES=$(find backend -name "*.ts" -o -name "*.js" 2>/dev/null | wc -l || echo 0)
CONFIG_FILES=$(find . -maxdepth 2 -name "docker*" -o -name "package*.json" -o -name ".env*" -o -name "*.config.*" 2>/dev/null | wc -l || echo 0)

# Get lines of code
TOTAL_LOC=0
if command -v cloc &>/dev/null; then
    TOTAL_LOC=$(cloc . --json --quiet 2>/dev/null | jq '.SUM.code' 2>/dev/null || echo 0)
else
    # Fallback: rough estimate
    TOTAL_LOC=$(find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)
fi

# Generate inventory JSON
cat > "$REPORTS_DIR/inventory.json" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "project": "MZ.S-ERP",
  "audit_version": "v5.2",
  "total_files": $TOTAL_FILES,
  "source_files": $SOURCE_FILES,
  "total_lines_of_code": $TOTAL_LOC,
  "file_types": {
    "typescript": $TS_FILES,
    "typescript_jsx": $TSX_FILES,
    "javascript": $JS_FILES,
    "prisma": $PRISMA_FILES,
    "json": $JSON_FILES
  },
  "categories": {
    "frontend": $FRONTEND_FILES,
    "backend": $BACKEND_FILES,
    "prisma_schemas": $PRISMA_FILES,
    "config": $CONFIG_FILES
  }
}
EOF

# Generate file tree
echo "Generating file tree..."
if command -v tree &>/dev/null; then
    tree -I 'node_modules|dist|build|.git|__pycache__|.next|coverage' -a -L 4 > "$REPORTS_DIR/file_tree.txt" 2>/dev/null || true
else
    find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" | sort > "$REPORTS_DIR/file_tree.txt"
fi

# List all TypeScript/TSX files for detailed analysis
find . -name "*.ts" -o -name "*.tsx" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" | sort > "$REPORTS_DIR/typescript-files.txt"

# List all controllers and services
find . -path "*/controller*" -name "*.ts" -not -path "*/node_modules/*" 2>/dev/null | sort > "$REPORTS_DIR/controllers.txt" || touch "$REPORTS_DIR/controllers.txt"
find . -path "*/service*" -name "*.ts" -not -path "*/node_modules/*" 2>/dev/null | sort > "$REPORTS_DIR/services.txt" || touch "$REPORTS_DIR/services.txt"

echo ""
echo "✅ Inventory Complete"
echo "   Total Files: $TOTAL_FILES"
echo "   Source Files: $SOURCE_FILES"
echo "   Lines of Code: $TOTAL_LOC"
echo "   Frontend: $FRONTEND_FILES files"
echo "   Backend: $BACKEND_FILES files"
echo ""
echo "📄 Output: $REPORTS_DIR/inventory.json"

exit 0
