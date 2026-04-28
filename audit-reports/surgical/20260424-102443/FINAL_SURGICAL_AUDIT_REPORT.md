# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-04-24T08:25:35.911Z
- Mode: static
- Decision: YELLOW
- Integrity Score: 0%
- Summary: High-severity findings require remediation before trust is restored.

## Severity Counts

- Critical: 0
- High: 26
- Medium: 81
- Low: 7
- Info: 0

## Inventory

```json
{
  "generatedAt": "2026-04-24T08:24:44.398Z",
  "totalFiles": 402,
  "sourceFiles": 286,
  "categories": {
    "frontend": 138,
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

1. [HIGH] Large React surface detected (1125 lines) | frontend/src/components/ItemManagement.tsx:1 | evidence: lines=1125
2. [HIGH] Large React surface detected (1611 lines) | frontend/src/pages/Items.tsx:1 | evidence: lines=1611
3. [HIGH] Large React surface detected (1697 lines) | frontend/src/components/Stocktaking.tsx:1 | evidence: lines=1697
4. [HIGH] Large React surface detected (1761 lines) | frontend/src/pages/StocktakingView.tsx:1 | evidence: lines=1761
5. [HIGH] Large React surface detected (1880 lines) | frontend/src/components/Statement.tsx:1 | evidence: lines=1880
6. [HIGH] Large React surface detected (4381 lines) | frontend/src/pages/OperationsView.tsx:1 | evidence: lines=4381
7. [HIGH] Large React surface detected (4382 lines) | frontend/src/components/DailyOperations.tsx:1 | evidence: lines=4382
8. [HIGH] Large React surface detected (956 lines) | frontend/src/components/Settings.tsx:1 | evidence: lines=956
9. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/BackupCenter.tsx:1 | evidence: frontend/src/components/BackupCenter.tsx <-> frontend/src/pages/BackupCenterView.tsx; similarity=1.00
10. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/DailyOperations.tsx:1 | evidence: frontend/src/components/DailyOperations.tsx <-> frontend/src/pages/OperationsView.tsx; similarity=1.00
11. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: frontend/src/components/OpeningBalancePage.tsx <-> frontend/src/pages/OpeningBalanceView.tsx; similarity=0.99
12. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/Stocktaking.tsx:1 | evidence: frontend/src/components/Stocktaking.tsx <-> frontend/src/pages/StocktakingView.tsx; similarity=0.95
13. [HIGH] npm audit reported 1 high vulnerabilities in frontend | evidence: workspace=frontend; severity=high; count=1
14. [HIGH] npm audit reported 1 high vulnerabilities in root | evidence: workspace=root; severity=high; count=1
15. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.prod.yml:11 | evidence: POSTGRES_PASSWORD: [REDACTED]
16. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.prod.yml:24 | evidence: DATABASE_URL: [REDACTED]
17. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.yml:11 | evidence: POSTGRES_PASSWORD: [REDACTED]
18. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.yml:23 | evidence: DATABASE_URL: [REDACTED]
19. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.yml:24 | evidence: JWT_SECRET: [REDACTED]
20. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.yml:25 | evidence: RESET_TOKEN: [REDACTED]

## Stage Status

- Static findings: 114
- Runtime findings: 0
