# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-04-24T08:15:06.364Z
- Mode: static
- Decision: RED
- Integrity Score: 0%
- Summary: Critical findings were detected.

## Severity Counts

- Critical: 2
- High: 29
- Medium: 81
- Low: 7
- Info: 0

## Inventory

```json
{
  "generatedAt": "2026-04-24T08:14:35.647Z",
  "totalFiles": 400,
  "sourceFiles": 284,
  "categories": {
    "frontend": 138,
    "backend": 105,
    "controllers": 17,
    "dtoAndValidation": 30,
    "prisma": 1,
    "configs": 12,
    "tests": 18
  },
  "giantComponents": [
    {
      "path": "frontend/src/components/DailyOperations.tsx",
      "lines": 4382
    },
    {
      "path": "frontend/src/pages/OperationsView.tsx",
      "lines": 4381
    },
    {
      "path": "frontend/src/components/Statement.tsx",
      "lines": 1880
    },
    {
      "path": "frontend/src/pages/StocktakingView.tsx",
      "lines": 1761
    },
    {
      "path": "frontend/src/components/Stocktaking.tsx",
      "lines": 1697
    },
    {
      "path": "frontend/src/pages/Items.tsx",
      "lines": 1611
    },
    {
      "path": "frontend/src/components/ItemManagement.tsx",
      "lines": 1125
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
      "lines": 620
    },
    {
      "path": "frontend/src/pages/OpeningBalanceView.tsx",
      "lines": 618
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

1. [CRITICAL] Prisma raw SQL usage detected ($executeRawUnsafe) | backend/src/backup/backup.service.ts:971 | evidence: $executeRawUnsafe
2. [CRITICAL] Prisma raw SQL usage detected ($queryRawUnsafe) | backend/src/monitoring/monitoring.service.ts:36 | evidence: $queryRawUnsafe
3. [HIGH] Large React surface detected (1125 lines) | frontend/src/components/ItemManagement.tsx:1 | evidence: lines=1125
4. [HIGH] Large React surface detected (1611 lines) | frontend/src/pages/Items.tsx:1 | evidence: lines=1611
5. [HIGH] Large React surface detected (1697 lines) | frontend/src/components/Stocktaking.tsx:1 | evidence: lines=1697
6. [HIGH] Large React surface detected (1761 lines) | frontend/src/pages/StocktakingView.tsx:1 | evidence: lines=1761
7. [HIGH] Large React surface detected (1880 lines) | frontend/src/components/Statement.tsx:1 | evidence: lines=1880
8. [HIGH] Large React surface detected (4381 lines) | frontend/src/pages/OperationsView.tsx:1 | evidence: lines=4381
9. [HIGH] Large React surface detected (4382 lines) | frontend/src/components/DailyOperations.tsx:1 | evidence: lines=4382
10. [HIGH] Large React surface detected (956 lines) | frontend/src/components/Settings.tsx:1 | evidence: lines=956
11. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/BackupCenter.tsx:1 | evidence: frontend/src/components/BackupCenter.tsx <-> frontend/src/pages/BackupCenterView.tsx; similarity=1.00
12. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/DailyOperations.tsx:1 | evidence: frontend/src/components/DailyOperations.tsx <-> frontend/src/pages/OperationsView.tsx; similarity=1.00
13. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: frontend/src/components/OpeningBalancePage.tsx <-> frontend/src/pages/OpeningBalanceView.tsx; similarity=0.99
14. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/Stocktaking.tsx:1 | evidence: frontend/src/components/Stocktaking.tsx <-> frontend/src/pages/StocktakingView.tsx; similarity=0.95
15. [HIGH] npm audit reported 1 high vulnerabilities in frontend | evidence: workspace=frontend; severity=high; count=1
16. [HIGH] npm audit reported 1 high vulnerabilities in root | evidence: workspace=root; severity=high; count=1
17. [HIGH] Prisma raw SQL usage detected ($executeRaw) | backend/src/backup/backup.service.ts:971 | evidence: $executeRaw
18. [HIGH] Prisma raw SQL usage detected ($queryRaw) | backend/src/monitoring/monitoring.service.ts:36 | evidence: $queryRaw
19. [HIGH] Prisma schema validation failed | evidence: Failed to parse syntax of config file at "C:\Users\ireac\Documents\GitHub\MZ.S-ERP\prisma.config.js"
20. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.prod.yml:11 | evidence: POSTGRES_PASSWORD: [REDACTED]

## Stage Status

- Static findings: 119
- Runtime findings: 0
