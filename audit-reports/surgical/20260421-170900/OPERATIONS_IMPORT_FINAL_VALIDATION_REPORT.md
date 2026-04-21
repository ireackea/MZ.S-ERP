# OPERATIONS_IMPORT_FINAL_VALIDATION_REPORT

- Generated: 2026-04-21 17:09 local
- Status: GREEN
- Scope: Items Excel import, Operations import/export permissions, Operations duplicate-write prevention, final runtime validation

## Executive Summary

The Operations import regression is resolved in a way that matches the existing architecture.

The fix was not limited to enabling the button. The actual failure chain had three separate root causes:

1. Items Excel import was rejected at the backend validation boundary because the request DTO was inline and undecorated under Nest whitelist validation.
2. Operations route refactoring split the wrapper from the view but failed to pass `canImport`, `canExport`, `onImport`, and `onExport` into `OperationsView`.
3. Operations Excel import could write the same transaction twice because `executeWithSync('/transactions/bulk', ...)` already performed the online write and the wrapper callback path posted the same rows again.

These defects are now corrected and validated with both targeted tests and a real browser import run.

## Changes Applied

### Backend

- Added a decorated bulk import DTO for Items import.
- Updated the item controller to use validated DTO classes instead of inline undecorated request classes.

### Frontend

- Normalized Items import API errors through the shared error handler.
- Restored import/export permission and activity callback passthrough from `Operations.tsx` to `OperationsView.tsx`.
- Removed the incorrect dependency on `session.token` for Operations import/export availability.
- Updated the Operations bulk-save flow to preserve client ids in the payload so the backend can reuse them as `publicId`.
- Removed the second online write path after `executeWithSync(...)`.
- Added rollback behavior for optimistic local updates if the server bulk save fails.
- Guarded the quick export path with the same permission gate as the main export flow.
- Added a focused wrapper regression test for `Operations.tsx`.

## Validation Performed

### Targeted Test

Command:

```text
npm run test --workspace=frontend -- --run src/pages/Operations.test.tsx
```

Result:

- Passed: 2 tests
- Covered wrapper permission passthrough without a `session.token`
- Covered add-transaction behavior using the API result before local stock updates

### Full Build

Command:

```text
npm run build:full
```

Result:

- Passed
- Frontend production build succeeded
- Backend TypeScript build succeeded

### Real Runtime Import Proof

A real `.xlsx` file was generated and imported through the Operations UI in the browser.

Fixture row:

- `date=2026-04-21`
- `type=import`
- `warehouseInvoice=AUTO-OPS-20260421-E2E-01`
- `itemName=21006`
- `partnerName=Partner Test`
- `quantity=1.25`
- `supplierNet=1.2`

Observed runtime result:

- Import preview accepted exactly 1 valid row and 0 invalid rows
- Item token `21006` resolved to `اكياس اعلاف مواشي 50k`
- Backend verification returned exactly 1 persisted transaction for that invoice
- The created transaction was then deleted successfully as cleanup
- Post-cleanup transaction count for that invoice returned to 0

This confirms the critical behavioral guarantee:

1 imported Excel row produced 1 persisted transaction, not 2.

## Residual Observations

- During runtime validation, the browser still reported a React warning about duplicate child keys somewhere in the Operations surface. That warning did not block import/export behavior, but it should be investigated separately.
- Existing broad frontend tests can still emit a post-test lazy-import teardown warning in unrelated application-shell paths. That is separate from the Operations import regression fixed here.

## Final Decision

The Operations import/export path is approved as fixed for the validated regression scope.