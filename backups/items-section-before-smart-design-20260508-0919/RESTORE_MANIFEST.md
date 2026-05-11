# Items Section Backup Before Smart Design

Created: 2026-05-08 09:19 local workspace time.

Purpose: backup of the current Items section files before wiring the smart catalog redesign as the main Items UI.

Backed up files:

- frontend/src/pages/items/ItemsPageContent.tsx
- frontend/src/pages/items/ItemsCatalog.tsx
- frontend/src/pages/items/ItemsDialogs.tsx
- frontend/src/pages/items/shared.ts
- frontend/src/services/gridModules.ts
- frontend/src/types.ts
- frontend/src/store/useInventoryStore.ts

Restore approach:

1. Copy the matching files from this backup folder back to the repository root, preserving the relative paths.
2. Remove frontend/src/pages/items/ItemsSmartCatalog.tsx if you want to fully return to the old catalog wiring.
3. Rebuild the frontend and restart the official runtime.

Verification completed after redesign:

- VS Code diagnostics: no errors in touched files.
- Frontend build: passed.
- Official runtime: frontend 200, backend health 200, proxy health 200.
- Served container bundle contains the new smart catalog markers.
