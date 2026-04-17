# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-04-17T18:09:23.267Z
- Mode: static
- Decision: RED
- Integrity Score: 0%
- Summary: Critical findings were detected.

## Severity Counts

- Critical: 3
- High: 27
- Medium: 66
- Low: 9
- Info: 0

## Inventory

```json
{
  "generatedAt": "2026-04-17T18:09:01.163Z",
  "totalFiles": 310,
  "sourceFiles": 251,
  "categories": {
    "frontend": 117,
    "backend": 85,
    "controllers": 13,
    "dtoAndValidation": 25,
    "prisma": 1,
    "configs": 13,
    "tests": 11
  },
  "giantComponents": [
    {
      "path": "frontend/src/pages/OperationsView.tsx",
      "lines": 4334
    },
    {
      "path": "frontend/src/components/DailyOperations.tsx",
      "lines": 4332
    },
    {
      "path": "frontend/src/components/Statement.tsx",
      "lines": 1877
    },
    {
      "path": "frontend/src/pages/StocktakingView.tsx",
      "lines": 1695
    },
    {
      "path": "frontend/src/components/Stocktaking.tsx",
      "lines": 1693
    },
    {
      "path": "frontend/src/components/ItemManagement.tsx",
      "lines": 1125
    },
    {
      "path": "frontend/src/components/Settings.tsx",
      "lines": 954
    },
    {
      "path": "frontend/src/pages/Items.tsx",
      "lines": 856
    },
    {
      "path": "frontend/src/components/UnifiedIAM.tsx",
      "lines": 796
    },
    {
      "path": "frontend/src/App.tsx",
      "lines": 750
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
      "path": "frontend/src/pages/OpeningBalanceView.tsx",
      "lines": 622
    },
    {
      "path": "frontend/src/components/OpeningBalancePage.tsx",
      "lines": 620
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
      "name": ".qwen",
      "type": "directory"
    },
    {
      "name": "audit-reports",
      "type": "directory"
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
      "name": "FINAL_SURGICAL_AUDIT_REPORT_2026-03-28.md",
      "type": "file"
    },
    {
      "name": "frontend",
      "type": "directory"
    },
    {
      "name": "MZS-ERP_FINAL_AUDIT_REPORT_2026-03-28.pdf",
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
      "name": "production.log",
      "type": "file"
    },
    {
      "name": "README.md",
      "type": "file"
    },
    {
      "name": "scripts",
      "type": "directory"
    },
    {
      "name": "SECURITY_FIXES_REPORT_2026-03-28.md",
      "type": "file"
    },
    {
      "name": "START_PROD_ULTIMATE_v4 old.bat",
      "type": "file"
    },
    {
      "name": "START_PROD_ULTIMATE_v4.bat",
      "type": "file"
    },
    {
      "name": "START_PROD_ULTIMATE_v5.bat",
      "type": "file"
    },
    {
      "name": "SYSTEM_RUN_REPORT_2026-03-28.md",
      "type": "file"
    },
    {
      "name": "tests",
      "type": "directory"
    },
    {
      "name": "دليل-التشغيل.md",
      "type": "file"
    }
  ]
}
```

## Runtime Checks

- Skipped intentionally via `-StaticOnly`.

## Top Findings

1. [CRITICAL] Prisma raw SQL usage detected ($executeRawUnsafe) | backend/src/backup/backup.service.ts:971 | evidence: $executeRawUnsafe
2. [CRITICAL] Prisma raw SQL usage detected ($queryRawUnsafe) | backend/src/monitoring/monitoring.service.ts:36 | evidence: $queryRawUnsafe
3. [CRITICAL] Socket.IO gateway does not show an authentication check | backend/src/realtime/realtime.gateway.ts:110 | evidence: namespace=/realtime
4. [HIGH] Frontend token storage drifts from backend cookie-only policy | frontend/src/api/client.ts:22 | evidence: localStorage.getItem('feed_factory_jwt_token')
5. [HIGH] Large React surface detected (1125 lines) | frontend/src/components/ItemManagement.tsx:1 | evidence: lines=1125
6. [HIGH] Large React surface detected (1693 lines) | frontend/src/components/Stocktaking.tsx:1 | evidence: lines=1693
7. [HIGH] Large React surface detected (1695 lines) | frontend/src/pages/StocktakingView.tsx:1 | evidence: lines=1695
8. [HIGH] Large React surface detected (1877 lines) | frontend/src/components/Statement.tsx:1 | evidence: lines=1877
9. [HIGH] Large React surface detected (4332 lines) | frontend/src/components/DailyOperations.tsx:1 | evidence: lines=4332
10. [HIGH] Large React surface detected (4334 lines) | frontend/src/pages/OperationsView.tsx:1 | evidence: lines=4334
11. [HIGH] Large React surface detected (856 lines) | frontend/src/pages/Items.tsx:1 | evidence: lines=856
12. [HIGH] Large React surface detected (954 lines) | frontend/src/components/Settings.tsx:1 | evidence: lines=954
13. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/BackupCenter.tsx:1 | evidence: frontend/src/components/BackupCenter.tsx <-> frontend/src/pages/BackupCenterView.tsx; similarity=1.00
14. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/DailyOperations.tsx:1 | evidence: frontend/src/components/DailyOperations.tsx <-> frontend/src/pages/OperationsView.tsx; similarity=1.00
15. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: frontend/src/components/OpeningBalancePage.tsx <-> frontend/src/pages/OpeningBalanceView.tsx; similarity=1.00
16. [HIGH] Large React surfaces appear substantially duplicated | frontend/src/components/Stocktaking.tsx:1 | evidence: frontend/src/components/Stocktaking.tsx <-> frontend/src/pages/StocktakingView.tsx; similarity=1.00
17. [HIGH] Prisma raw SQL usage detected ($executeRaw) | backend/src/backup/backup.service.ts:971 | evidence: $executeRaw
18. [HIGH] Prisma raw SQL usage detected ($queryRaw) | backend/src/monitoring/monitoring.service.ts:36 | evidence: $queryRaw
19. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.prod.yml:14 | evidence: DATABASE_URL: [REDACTED]
20. [HIGH] Tracked file contains a hardcoded secret-like assignment | docker-compose.yml:11 | evidence: POSTGRES_PASSWORD: [REDACTED]

## Stage Status

- Static findings: 105
- Runtime findings: 0
