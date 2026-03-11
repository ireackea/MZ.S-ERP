# PHASE 2 - Full Single Source of Truth & Legacy Cleanup Report

Date: 2026-03-05
Scope: Frontend allowed files only

## Summary

Phase 2 completed for the allowed file set by making Zustand the active source of truth for inventory domain reads inside the allowed components and root app wiring.

Implemented outcomes:
- Added opening balances ownership to `frontend/src/store/useInventoryStore.ts`
- Extended `loadAll()` and server sync to include opening balances
- Migrated `frontend/src/components/StockBalances.tsx` from local opening-balance state/effect to Zustand selectors and store actions
- Migrated `frontend/src/components/DailyOperations.tsx` to read `items` and `transactions` from Zustand with `loadAll()` on mount
- Removed `InventoryProvider` dependency from `frontend/src/App.tsx`
- Removed prop-based inventory wiring in allowed routes for `StockBalances`, `DailyOperations`, `Stocktaking`, and `Formulation`
- Added the required Phase 2 header to the remaining allowed files that participate in the Phase 2 flow
- Reduced `frontend/src/contexts/InventoryContext.tsx` to a store-backed compatibility shim for out-of-scope consumers
- Added exact Phase 2 header comment to each edited file

## Files Changed

- `frontend/src/store/useInventoryStore.ts`
- `frontend/src/contexts/InventoryContext.tsx`
- `frontend/src/components/Dashboard.tsx`
- `frontend/src/components/StockBalances.tsx`
- `frontend/src/components/ItemManagement.tsx`
- `frontend/src/components/Stocktaking.tsx`
- `frontend/src/components/Formulation.tsx`
- `frontend/src/components/DailyOperations.tsx`
- `frontend/src/App.tsx`
- `frontend/src/main.tsx`

## Code Added / Updated

### Zustand Store
- Added `openingBalances`, `openingBalancesYear`, `openingBalancesLoading`, and `openingBalancesError`
- Added `loadOpeningBalances(financialYear?)`
- Added `setOpeningBalances(financialYear, rows)`
- Updated `loadAll()` to hydrate local opening balances immediately
- Updated `syncFromServer()` to fetch opening balances from API with local fallback
- Persisted successful API opening-balance sync into the legacy local opening-balance cache for backward compatibility

### StockBalances
- Removed direct API calls and local synchronization state for opening balances
- Reads opening balances directly from Zustand
- Triggers `loadOpeningBalances(financialYear)` through store action
- Uses store error/loading state for opening-balance sync feedback

### DailyOperations
- Replaced direct dependency on route-provided inventory arrays with Zustand-backed `items` and `transactions`
- Added `loadAll()` mount hydration
- Kept mutation callbacks from `App.tsx` unchanged to avoid breaking permission and audit orchestration

### App
- Removed `InventoryProvider` import and wrapper completely
- Kept post-login `useInventoryStore.getState().loadAll()` hydration path
- Removed prop injection for allowed routes where Zustand is now the active read source
- Updated stale comment that referenced the legacy InventoryContext sync path

### InventoryContext
- Replaced the legacy mixed implementation with a minimal compatibility shim backed directly by `useInventoryStore`
- Kept `useInventory()` available only to avoid breaking out-of-scope files that still import it
- Confirmed `InventoryProvider` is now a no-op pass-through and no longer participates in the active app root

### Remaining Allowed Files
- Added the required Phase 2 header marker to `Dashboard`, `ItemManagement`, `Stocktaking`, `Formulation`, and `main.tsx`
- Confirmed these files already use Zustand or no longer depend on `InventoryProvider`

## InventoryContext Deletion Status

Requested goal: delete `frontend/src/contexts/InventoryContext.tsx` completely.

Status: full physical deletion is still blocked because deletion would immediately break live imports in files outside the user-approved edit scope:
- `frontend/src/pages/Items.tsx`
- `frontend/src/pages/Operations.tsx`
- `frontend/src/components/OpeningBalancePage.tsx`

Applied mitigation inside the allowed scope:
- the root app no longer uses `InventoryProvider`
- the compatibility file now delegates directly to Zustand only
- no allowed Phase 2 route depends on context state ownership anymore

This means the legacy provider dependency has been removed from the root app and from the allowed Phase 2 route flow, but full physical deletion of the compatibility file still requires a follow-up cleanup phase covering those remaining references.

## Validation / Test Results

Validated:
- `frontend/src/store/useInventoryStore.ts`: no errors reported
- `frontend/src/components/StockBalances.tsx`: no errors reported
- `frontend/src/contexts/InventoryContext.tsx`: no errors reported
- `frontend/src/components/Dashboard.tsx`: no errors reported
- `frontend/src/components/Formulation.tsx`: no errors reported
- `frontend/src/main.tsx`: no errors reported

Observed existing non-blocking issues outside the direct Phase 2 change surface:
- `frontend/src/App.tsx`: existing inline-style lint rule warning
- `frontend/src/components/DailyOperations.tsx`: existing inline-style and accessibility lint warnings already present in the file
- `frontend/src/components/ItemManagement.tsx`: existing inline-style and accessibility warnings already present in the file
- `frontend/src/components/Stocktaking.tsx`: existing inline-style warnings already present in the file

No automated screenshot capture is available in this environment.

## Screenshots

Not captured from the current environment.

## Architectural Confirmation

For the allowed Phase 2 scope, Zustand now owns the active inventory read path for:
- items
- transactions
- users
- roles
- units
- categories
- opening balances

Root `App.tsx` no longer depends on `InventoryProvider`.

## Remaining Follow-up Required For Full Physical Legacy Removal

A final cleanup phase is still required to update and then delete the remaining compatibility context file safely:
- `frontend/src/pages/Items.tsx`
- `frontend/src/pages/Operations.tsx`
- `frontend/src/components/OpeningBalancePage.tsx`
- then delete `frontend/src/contexts/InventoryContext.tsx`
