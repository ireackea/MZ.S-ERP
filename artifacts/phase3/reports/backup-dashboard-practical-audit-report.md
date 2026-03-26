# Backup Dashboard Practical Audit Report

Date: 2026-03-26
Repository: MZ.S-ERP
Scope: Re-audit of the Backup section inside Settings after user-reported suspicion of remaining encoding corruption.

## Objective

Verify, on the active runtime and on the source files, whether the Settings Backup section still contains broken Arabic encoding.

## Practical Inspection Performed

### 1. Source Inspection

Checked the active component source:

1. frontend/src/components/BackupCenter.tsx
2. frontend/src/modules/settings/components/BackupAndRestore.tsx

Result:

1. No broken backup strings were found in the current BackupCenter source.
2. The displayed labels in the component are proper Arabic strings.

### 2. Live Runtime Inspection On Direct Backup Route

Opened the active application on:

1. /backup

Authenticated as superadmin and extracted the rendered page text from the live frontend running on port 4173.

Observed rendered backup header and content included clean strings such as:

1. لوحة النسخ الاحتياطي والاستعادة
2. إدارة النسخ اليدوية والمجدولة مع التحقق من السلامة، التنزيل، والاستعادة الآمنة عبر لقطة حماية مسبقة.
3. إعدادات الجدولة والحماية
4. سجل النسخ الاحتياطية

Result:

1. No visible encoding corruption was present on the direct backup route.

### 3. Live Runtime Inspection Through Settings Page

Opened the active application on:

1. /settings

Then selected the Backup tab from inside the Settings page and extracted the rendered text.

Observed:

1. The backup tab loaded successfully.
2. The rendered strings were clean Arabic.
3. No page runtime errors were emitted.

Runtime error result:

1. PAGE_ERRORS=[]

## Additional Hardening Added

To make this failure mode testable and non-regressive, the following tests were strengthened:

1. tests/e2e/backup-dashboard.spec.ts
2. tests/e2e/settings-regression.spec.ts

The tests now assert that known corruption markers do not appear in the rendered backup text, including old strings such as:

1. Backup Dashboard
2. Safety Snapshot
3. Restore PIN (2FA)
4. legacy garble token patterns previously seen during the defect investigation

## Verification Outcome

Conclusion for the Backup section specifically:

1. The current source code for the Backup section is clean.
2. The live runtime on /backup is clean.
3. The live runtime inside /settings > النسخ الاحتياطي is clean.
4. No active encoding defect was reproduced in the Backup section during this re-audit.

## Important Boundary Note

The repository still contains encoding corruption in other unrelated frontend areas outside the Backup section. During broad text scanning, corrupted strings were found in components such as:

1. frontend/src/components/Orders.tsx
2. frontend/src/components/Partners.tsx
3. frontend/src/components/Statement.tsx

This means:

1. the user concern about Arabic encoding in the project is valid in general,
2. but the Backup section itself was not reproducibly corrupted in the active runtime during this audit.

## Final Determination

The Backup section in Settings does not currently exhibit the reported encoding corruption in the inspected live runtime. If the user still sees broken text specifically in that section, the most probable causes are:

1. a stale browser cache,
2. an older frontend container or launcher session still serving an outdated bundle,
3. a different screen outside Backup being confused with the Backup tab.