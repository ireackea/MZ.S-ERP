# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-04-24T13:47:57.221Z
- Mode: static
- Decision: YELLOW
- Integrity Score: 0%
- Summary: High-severity findings require remediation before trust is restored.

## Severity Counts

- Critical: 0
- High: 17
- Medium: 63
- Low: 7
- Info: 0

## Inventory

```json
{
  "generatedAt": "2026-04-24T13:47:24.796Z",
  "totalFiles": 403,
  "sourceFiles": 287,
  "categories": {
    "frontend": 139,
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
      "path": "frontend/src/pages/OperationsView.tsx",
      "lines": 4348
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
      "path": "frontend/src/components/Stocktaking.tsx",
      "lines": 1685
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
      "path": "frontend/src/components/UnifiedIAM.tsx",
      "lines": 796
    },
    {
      "path": "frontend/src/App.tsx",
      "lines": 786
    },
    {
      "path": "frontend/src/pages/BackupCenterView.tsx",
      "lines": 697
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
      "path": "frontend/src/pages/OpeningBalanceView.tsx",
      "lines": 611
    },
    {
      "path": "frontend/src/components/ItemForm.tsx",
      "lines": 598
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
3. [HIGH] Large React surface detected (1685 lines) | frontend/src/components/Stocktaking.tsx:1 | evidence: lines=1685
4. [HIGH] Large React surface detected (1749 lines) | frontend/src/pages/StocktakingView.tsx:1 | evidence: lines=1749
5. [HIGH] Large React surface detected (1880 lines) | frontend/src/components/Statement.tsx:1 | evidence: lines=1880
6. [HIGH] Large React surface detected (4348 lines) | frontend/src/pages/OperationsView.tsx:1 | evidence: lines=4348
7. [HIGH] Large React surface detected (4349 lines) | frontend/src/components/DailyOperations.tsx:1 | evidence: lines=4349
8. [HIGH] Large React surface detected (956 lines) | frontend/src/components/Settings.tsx:1 | evidence: lines=956
9. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/BackupCenter.tsx:1 | evidence: frontend/src/components/BackupCenter.tsx <-> frontend/src/pages/BackupCenterView.tsx; similarity=1.00
10. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/DailyOperations.tsx:1 | evidence: frontend/src/components/DailyOperations.tsx <-> frontend/src/pages/OperationsView.tsx; similarity=1.00
11. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: frontend/src/components/OpeningBalancePage.tsx <-> frontend/src/pages/OpeningBalanceView.tsx; similarity=0.99
12. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/Stocktaking.tsx:1 | evidence: frontend/src/components/Stocktaking.tsx <-> frontend/src/pages/StocktakingView.tsx; similarity=0.95
13. [HIGH] Type safety hotspot: 12 any-casts/usages | backend/src/backup/backup.service.ts:1 | evidence: anyUsages=12
14. [HIGH] Type safety hotspot: 13 any-casts/usages | frontend/src/components/UnifiedIAM.tsx:1 | evidence: anyUsages=13
15. [HIGH] Type safety hotspot: 15 any-casts/usages | frontend/src/store/useInventoryStore.ts:1 | evidence: anyUsages=15
16. [HIGH] Type safety hotspot: 18 any-casts/usages | backend/src/reports/report.service.ts:1 | evidence: anyUsages=18
17. [HIGH] Type safety hotspot: 19 any-casts/usages | backend/src/backup/backup.controller.ts:1 | evidence: anyUsages=19
18. [MEDIUM] Large React surface detected (598 lines) | frontend/src/components/ItemForm.tsx:1 | evidence: lines=598
19. [MEDIUM] Large React surface detected (611 lines) | frontend/src/pages/OpeningBalanceView.tsx:1 | evidence: lines=611
20. [MEDIUM] Large React surface detected (613 lines) | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: lines=613

## Stage Status

- Static findings: 87
- Runtime findings: 0
