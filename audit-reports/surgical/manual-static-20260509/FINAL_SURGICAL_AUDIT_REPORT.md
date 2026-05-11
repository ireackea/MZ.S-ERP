# FINAL_SURGICAL_AUDIT_REPORT

- Generated: 2026-05-09T21:36:49.419Z
- Mode: static
- Decision: YELLOW
- Integrity Score: 0%
- Summary: High-severity findings require remediation before trust is restored.

## Severity Counts

- Critical: 0
- High: 6
- Medium: 64
- Low: 7
- Info: 0

## Inventory

```json
{
  "generatedAt": "2026-05-09T21:29:28.169Z",
  "totalFiles": 507,
  "sourceFiles": 319,
  "categories": {
    "frontend": 162,
    "backend": 112,
    "controllers": 18,
    "dtoAndValidation": 31,
    "prisma": 1,
    "configs": 12,
    "tests": 19
  },
  "giantComponents": [
    {
      "path": "frontend/src/components/DailyOperations.tsx",
      "lines": 4071
    },
    {
      "path": "frontend/src/components/UnifiedIAM.tsx",
      "lines": 944
    },
    {
      "path": "frontend/src/App.tsx",
      "lines": 793
    },
    {
      "path": "frontend/src/modules/settings/components/ReferenceDataSettings.tsx",
      "lines": 753
    },
    {
      "path": "frontend/src/components/BackupCenter.tsx",
      "lines": 695
    },
    {
      "path": "frontend/src/pages/items/ItemsPageContent.tsx",
      "lines": 690
    },
    {
      "path": "frontend/src/modules/settings/components/SystemReset.tsx",
      "lines": 685
    },
    {
      "path": "frontend/src/components/Statement.tsx",
      "lines": 648
    },
    {
      "path": "frontend/src/components/StockCardReport.tsx",
      "lines": 648
    },
    {
      "path": "frontend/src/components/OpeningBalancePage.tsx",
      "lines": 639
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
      "path": "frontend/src/pages/items/ItemsSmartCatalog.tsx",
      "lines": 555
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
      "name": "MZ.S-ERP.code-workspace",
      "type": "file"
    },
    {
      "name": "OPERATIONS.md",
      "type": "file"
    },
    {
      "name": "START_MZS_ERP_OFFICIAL.bat",
      "type": "file"
    },
    {
      "name": "backend",
      "type": "directory"
    },
    {
      "name": "build.log",
      "type": "file"
    },
    {
      "name": "copilot.exe",
      "type": "file"
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
      "name": "scripts",
      "type": "directory"
    },
    {
      "name": "start-mzs-erp-safe.ps1",
      "type": "file"
    },
    {
      "name": "stop-mzs-erp-safe.ps1",
      "type": "file"
    },
    {
      "name": "tests",
      "type": "directory"
    },
    {
      "name": "رصيد بداية المدة.xlsx",
      "type": "file"
    },
    {
      "name": "نموذج الأصناف.xlsx",
      "type": "file"
    },
    {
      "name": "نموذج وحدات القياس وقواعد التفريغ.xlsx",
      "type": "file"
    }
  ]
}
```

## Runtime Checks

- Skipped intentionally via `-StaticOnly`.

## Top Findings

1. [HIGH] Large React surface detected (4071 lines) | frontend/src/components/DailyOperations.tsx:1 | evidence: lines=4071
2. [HIGH] Large React surface detected (944 lines) | frontend/src/components/UnifiedIAM.tsx:1 | evidence: lines=944
3. [HIGH] npm audit reported 1 high vulnerabilities in frontend | evidence: workspace=frontend; severity=high; count=1
4. [HIGH] npm audit reported 2 high vulnerabilities in backend | evidence: workspace=backend; severity=high; count=2
5. [HIGH] npm audit reported 3 high vulnerabilities in root | evidence: workspace=root; severity=high; count=3
6. [HIGH] Type safety hotspot: 16 any-casts/usages | backend/src/monitoring/monitoring.service.ts:1 | evidence: anyUsages=16
7. [MEDIUM] Large React surface detected (497 lines) | frontend/src/components/FormulationForm.tsx:1 | evidence: lines=497
8. [MEDIUM] Large React surface detected (508 lines) | frontend/src/components/StockBalances.tsx:1 | evidence: lines=508
9. [MEDIUM] Large React surface detected (555 lines) | frontend/src/pages/items/ItemsSmartCatalog.tsx:1 | evidence: lines=555
10. [MEDIUM] Large React surface detected (582 lines) | frontend/src/components/Reports.tsx:1 | evidence: lines=582
11. [MEDIUM] Large React surface detected (598 lines) | frontend/src/components/ItemForm.tsx:1 | evidence: lines=598
12. [MEDIUM] Large React surface detected (639 lines) | frontend/src/components/OpeningBalancePage.tsx:1 | evidence: lines=639
13. [MEDIUM] Large React surface detected (648 lines) | frontend/src/components/Statement.tsx:1 | evidence: lines=648
14. [MEDIUM] Large React surface detected (648 lines) | frontend/src/components/StockCardReport.tsx:1 | evidence: lines=648
15. [MEDIUM] Large React surface detected (685 lines) | frontend/src/modules/settings/components/SystemReset.tsx:1 | evidence: lines=685
16. [MEDIUM] Large React surface detected (690 lines) | frontend/src/pages/items/ItemsPageContent.tsx:1 | evidence: lines=690
17. [MEDIUM] Large React surface detected (695 lines) | frontend/src/components/BackupCenter.tsx:1 | evidence: lines=695
18. [MEDIUM] Large React surface detected (753 lines) | frontend/src/modules/settings/components/ReferenceDataSettings.tsx:1 | evidence: lines=753
19. [MEDIUM] Large React surface detected (793 lines) | frontend/src/App.tsx:1 | evidence: lines=793
20. [MEDIUM] Lint pipeline is not configured end-to-end | evidence: hasLintScript=false; hasEslintConfig=false

## Stage Status

- Static findings: 77
- Runtime findings: 0
