# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-04-24T14:18:14.963Z
- Mode: static
- Decision: YELLOW
- Integrity Score: 0%
- Summary: High-severity findings require remediation before trust is restored.

## Severity Counts

- Critical: 0
- High: 6
- Medium: 63
- Low: 7
- Info: 0

## Inventory

```json
{
  "generatedAt": "2026-04-24T14:17:40.435Z",
  "totalFiles": 405,
  "sourceFiles": 289,
  "categories": {
    "frontend": 141,
    "backend": 107,
    "controllers": 17,
    "dtoAndValidation": 30,
    "prisma": 1,
    "configs": 12,
    "tests": 18
  },
  "giantComponents": [
    {
      "path": "frontend/src/components/DailyOperations.tsx",
      "lines": 4349
    },
    {
      "path": "frontend/src/components/Statement.tsx",
      "lines": 1880
    },
    {
      "path": "frontend/src/pages/StocktakingView.tsx",
      "lines": 1749
    },
    {
      "path": "frontend/src/pages/Items.tsx",
      "lines": 1611
    },
    {
      "path": "frontend/src/components/ItemManagement.tsx",
      "lines": 1133
    },
    {
      "path": "frontend/src/components/Settings.tsx",
      "lines": 956
    },
    {
      "path": "frontend/src/App.tsx",
      "lines": 786
    },
    {
      "path": "frontend/src/components/UnifiedIAM.tsx",
      "lines": 754
    },
    {
      "path": "frontend/src/components/BackupCenter.tsx",
      "lines": 695
    },
    {
      "path": "frontend/src/components/OpeningBalancePage.tsx",
      "lines": 613
    },
    {
      "path": "frontend/src/components/ItemForm.tsx",
      "lines": 598
    },
    {
      "path": "frontend/src/components/Reports.tsx",
      "lines": 582
    },
    {
      "path": "frontend/src/components/StockCardReport.tsx",
      "lines": 575
    },
    {
      "path": "frontend/src/components/StockBalances.tsx",
      "lines": 508
    },
    {
      "path": "frontend/src/components/FormulationForm.tsx",
      "lines": 497
    }
  ],
  "topLevelEntries": [
    {
      "name": ".dockerignore",
      "type": "file"
    },
    {
      "name": ".editorconfig",
      "type": "file"
    },
    {
      "name": ".env",
      "type": "file"
    },
    {
      "name": ".env.example",
      "type": "file"
    },
    {
      "name": ".gitattributes",
      "type": "file"
    },
    {
      "name": ".github",
      "type": "directory"
    },
    {
      "name": ".gitignore",
      "type": "file"
    },
    {
      "name": ".gitkeep",
      "type": "file"
    },
    {
      "name": "backend",
      "type": "directory"
    },
    {
      "name": "docker-compose.prod.yml",
      "type": "file"
    },
    {
      "name": "docker-compose.yml",
      "type": "file"
    },
    {
      "name": "frontend",
      "type": "directory"
    },
    {
      "name": "logs",
      "type": "directory"
    },
    {
      "name": "MZ.S-ERP.code-workspace",
      "type": "file"
    },
    {
      "name": "nginx.prod.conf",
      "type": "file"
    },
    {
      "name": "package-lock.json",
      "type": "file"
    },
    {
      "name": "package.json",
      "type": "file"
    },
    {
      "name": "prisma.config.js",
      "type": "file"
    },
    {
      "name": "prisma.config.mjs",
      "type": "file"
    },
    {
      "name": "prisma.config.ts",
      "type": "file"
    },
    {
      "name": "run-mzs-erp.bat",
      "type": "file"
    },
    {
      "name": "scripts",
      "type": "directory"
    },
    {
      "name": "start-mzs-erp-safe.ps1",
      "type": "file"
    },
    {
      "name": "start-mzs-erp.bat",
      "type": "file"
    },
    {
      "name": "START_PROD_ULTIMATE.bat",
      "type": "file"
    },
    {
      "name": "stop-mzs-erp-safe.ps1",
      "type": "file"
    },
    {
      "name": "tests",
      "type": "directory"
    }
  ]
}
```

## Runtime Checks

- Skipped intentionally via `-StaticOnly`.

## Top Findings

1. [HIGH] Large React surface detected (1133 lines) | frontend/src/components/ItemManagement.tsx:1 | evidence: lines=1133
2. [HIGH] Large React surface detected (1611 lines) | frontend/src/pages/Items.tsx:1 | evidence: lines=1611
3. [HIGH] Large React surface detected (1749 lines) | frontend/src/pages/StocktakingView.tsx:1 | evidence: lines=1749
4. [HIGH] Large React surface detected (1880 lines) | frontend/src/components/Statement.tsx:1 | evidence: lines=1880
5. [HIGH] Large React surface detected (4349 lines) | frontend/src/components/DailyOperations.tsx:1 | evidence: lines=4349
6. [HIGH] Large React surface detected (956 lines) | frontend/src/components/Settings.tsx:1 | evidence: lines=956
7. [MEDIUM] Large React surface detected (497 lines) | frontend/src/components/FormulationForm.tsx:1 | evidence: lines=497
8. [MEDIUM] Large React surface detected (508 lines) | frontend/src/components/StockBalances.tsx:1 | evidence: lines=508
9. [MEDIUM] Large React surface detected (575 lines) | frontend/src/components/StockCardReport.tsx:1 | evidence: lines=575
10. [MEDIUM] Large React surface detected (582 lines) | frontend/src/components/Reports.tsx:1 | evidence: lines=582
11. [MEDIUM] Large React surface detected (598 lines) | frontend/src/components/ItemForm.tsx:1 | evidence: lines=598
12. [MEDIUM] Large React surface detected (613 lines) | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: lines=613
13. [MEDIUM] Large React surface detected (695 lines) | frontend/src/components/BackupCenter.tsx:1 | evidence: lines=695
14. [MEDIUM] Large React surface detected (754 lines) | frontend/src/components/UnifiedIAM.tsx:1 | evidence: lines=754
15. [MEDIUM] Large React surface detected (786 lines) | frontend/src/App.tsx:1 | evidence: lines=786
16. [MEDIUM] Lint pipeline is not configured end-to-end | evidence: hasLintScript=false; hasEslintConfig=false
17. [MEDIUM] Mutation-heavy service lacks obvious audit logging | backend/src/backup/backup.service.ts:1 | evidence: mutations=30
18. [MEDIUM] Mutation-heavy service lacks obvious audit logging | backend/src/monitoring/monitoring.service.ts:1 | evidence: mutations=3
19. [MEDIUM] Mutation-heavy service lacks obvious audit logging | backend/src/theme/theme.service.ts:1 | evidence: mutations=1
20. [MEDIUM] Mutation-heavy service lacks obvious audit logging | backend/src/transaction/transaction.service.ts:1 | evidence: mutations=12

## Stage Status

- Static findings: 76
- Runtime findings: 0
