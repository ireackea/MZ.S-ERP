# System Page Duplication And Cleanup Consultation Report

Date: 2026-03-26
Repository: MZ.S-ERP
Scope: Unified external-consultation report combining the full duplication inventory and the architectural cleanup plan.
Constraint: Read-only architectural assessment for the duplication analysis itself. No application code was changed as part of this report.

## Executive Summary

The frontend currently operates in a mixed transitional architecture rather than a clean single-source page model.

The duplication patterns found are not all equal. They fall into four categories:

1. Duplicate routes that resolve to the same page implementation.
2. Wrapper pages that adapt older components to the current routing model.
3. Parallel implementations for the same functional domain.
4. Legacy or semi-orphaned files that remain in the tree and still influence maintenance decisions.

The highest-risk duplication zones are:

1. Settings
2. Dashboard
3. Reports
4. Backup access model

The main architectural issue is not only file-name duplication. The deeper problem is coexistence of two UI generations:

1. Older section components under frontend/src/components
2. Newer routed pages under frontend/src/pages
3. Modular settings implementation under frontend/src/modules/settings

This creates maintenance drift risk, route ambiguity, and a high chance of future fixes landing in the wrong file.

## Assessment Method

The analysis covered the following layers:

1. Active route bindings in frontend/src/App.tsx
2. Routed pages in frontend/src/pages
3. Legacy and direct-render section components in frontend/src/components
4. Modular settings implementation in frontend/src/modules/settings
5. Ownership comparison between what is imported, what is routed, and what still exists without clear active use

## Route-Level Findings

### Confirmed duplicate route aliases

1. `/` and `/dashboard` both route to DashboardPage
2. `/operations` and `/transactions` both route to OperationsPage

Impact:

1. Low immediate runtime risk
2. Medium documentation and regression-test complexity
3. Higher chance of inconsistent breadcrumbs, analytics, or permission assumptions later

## Section Inventory And Ownership Matrix

### 1. Dashboard

Active route target:

1. frontend/src/pages/Dashboard.tsx

Additional overlapping implementation:

1. frontend/src/components/Dashboard.tsx

Observed behavior:

1. `/` and `/dashboard` use the page implementation
2. Fallback `*` still renders the legacy-style component implementation

Duplication type:

1. Parallel implementation
2. Fallback-based legacy exposure

Risk level:

1. High

Reason:

1. There are two different Dashboard implementations still wired into runtime behavior.
2. Bug fixes may be applied to one implementation while another remains reachable.

### 2. Items

Active route target:

1. frontend/src/pages/Items.tsx

Legacy overlapping file:

1. frontend/src/components/ItemManagement.tsx

Observed behavior:

1. `/items` uses the newer page implementation
2. The old item component remains imported historically but is not the current routed target

Duplication type:

1. Legacy residual implementation

Risk level:

1. Medium

Reason:

1. The active route already prefers the new page, but the older implementation remains part of the architectural surface area and can still mislead future maintenance.

### 3. Operations

Active route target:

1. frontend/src/pages/Operations.tsx

Underlying rendered implementation:

1. frontend/src/components/DailyOperations.tsx

Observed behavior:

1. `/operations` and `/transactions` both resolve to OperationsPage
2. OperationsPage is an adapter that injects store and service behavior into DailyOperations

Duplication type:

1. Route alias duplication
2. Wrapper migration pattern

Risk level:

1. Medium

Reason:

1. There is not a second independent UI here, but there are two URLs and a wrapper layer that increases complexity.

### 4. Stocktaking

Active route target:

1. frontend/src/pages/Stocktaking.tsx

Underlying rendered implementation:

1. frontend/src/components/Stocktaking.tsx

Duplication type:

1. Wrapper migration pattern

Risk level:

1. Low to medium

Reason:

1. The page file is currently a thin route wrapper, not a fully separate product surface.
2. This is manageable but still signals incomplete migration.

### 5. Reports

Active route target:

1. frontend/src/pages/Reports.tsx

Additional overlapping implementation:

1. frontend/src/components/Reports.tsx

Observed behavior:

1. `/reports` uses the new page implementation
2. A separate older Reports component still exists in the codebase

Duplication type:

1. Parallel implementation

Risk level:

1. High

Reason:

1. The newer routed page is substantial and not just a wrapper.
2. The legacy component remains available in the repository and increases drift risk.

### 6. Formulation

Active route target:

1. frontend/src/pages/Formulation.tsx

Underlying rendered implementation:

1. frontend/src/components/Formulation.tsx

Duplication type:

1. Wrapper migration pattern

Risk level:

1. Low to medium

Reason:

1. This is primarily a route wrapper over the existing implementation rather than two competing pages.

### 7. Opening Balance

Active route target:

1. frontend/src/pages/OpeningBalancePage.tsx

Underlying rendered implementation:

1. frontend/src/components/OpeningBalancePage.tsx

Duplication type:

1. Wrapper migration pattern

Risk level:

1. Low to medium

Reason:

1. The route page mainly injects configuration and delegates rendering to the component implementation.

### 8. Settings

Active route target:

1. frontend/src/modules/settings/pages/Settings.tsx

Additional overlapping implementation:

1. frontend/src/components/Settings.tsx

Observed behavior:

1. The modular settings page is the active `/settings` target.
2. The legacy Settings component is still large, feature-rich, and logically independent.
3. The older Settings implementation contains its own tab system and embeds areas such as UnifiedIAM and AuditLogViewer.

Duplication type:

1. Parallel domain implementation
2. Two-generation coexistence

Risk level:

1. Very high

Reason:

1. This is not a trivial wrapper duplication.
2. There are effectively two competing ways to represent the Settings domain.
3. This is the most important consolidation target in the frontend.

### 9. Backup

Active access paths:

1. Direct route `/backup` renders frontend/src/components/BackupCenter.tsx
2. Settings tab `backup` in frontend/src/modules/settings/pages/Settings.tsx renders frontend/src/modules/settings/components/BackupAndRestore.tsx, which delegates to frontend/src/components/BackupCenter.tsx

Additional overlapping file:

1. frontend/src/pages/BackupCenter.tsx

Duplication type:

1. Information architecture duplication
2. Wrapper duplication
3. Semi-orphaned page file

Risk level:

1. High

Reason:

1. Backup is reachable both as a standalone section and as a settings subdomain.
2. This duplicates user navigation models and can fragment policy and permission expectations.
3. There is also a page wrapper file that does not appear to be the active routed target.

### 10. Audit Logs

Active modular wrapper:

1. frontend/src/modules/settings/components/AuditLogs.tsx

Underlying rendered implementation:

1. frontend/src/components/AuditLogs.tsx

Duplication type:

1. Permission wrapper over shared display component

Risk level:

1. Low

Reason:

1. This is an acceptable compositional wrapper if retained intentionally.
2. It does not currently look like two independent user-facing products.

## Duplication Classification Summary

### Category A: True runtime route duplication

1. `/` and `/dashboard`
2. `/operations` and `/transactions`

### Category B: Wrapper-page migration duplication

1. OperationsPage -> DailyOperations
2. StocktakingPage -> Stocktaking
3. FormulationPage -> Formulation
4. OpeningBalanceRoutePage -> OpeningBalancePage
5. Settings backup and audit wrappers over shared base components

### Category C: Parallel implementations with higher cleanup priority

1. Dashboard page vs Dashboard component
2. Reports page vs Reports component
3. Settings modular page vs legacy Settings component

### Category D: Legacy or semi-orphaned artifacts

1. pages/BackupCenter.tsx
2. ItemManagement as historical overlap with ItemsPage
3. Imports that remain loaded in App.tsx although the route now points elsewhere

## Root Causes

The duplication appears to come from phased migration rather than uncontrolled random growth.

Most likely causes:

1. Incremental adoption of routed page wrappers without retiring the original section components.
2. Introduction of a modular Settings domain without fully decommissioning the earlier monolithic Settings screen.
3. Preservation of legacy routes and fallback behavior to reduce regression risk during earlier delivery phases.
4. Lack of an enforced rule defining which layer is the single source of truth for each domain.

## Architectural Risk Assessment

### Business and maintenance risks

1. Future fixes may land in non-active files.
2. Permission behavior may drift between legacy and modular implementations.
3. Test coverage may validate one path while another remains stale.
4. Route aliases can cause analytics, training, and user documentation inconsistency.
5. The Settings domain can become a persistent source of rework if not consolidated first.

### Operational risk by priority

1. Very high: Settings
2. High: Dashboard, Reports, Backup access model
3. Medium: Items residual overlap, Operations aliasing
4. Low to medium: Formulation, Stocktaking, Opening Balance wrapper pages
5. Low: AuditLogs modular wrapper over shared base component

## Recommended Cleanup Plan

### Phase 1: Establish page ownership rules

Goal:

1. Define one active owner for every domain.

Actions:

1. Freeze new feature work into legacy duplicates.
2. Declare whether each section is owned by `pages`, `components`, or `modules/settings`.
3. Treat `frontend/src/App.tsx` route targets as the authoritative runtime map.

Deliverable:

1. A section ownership matrix approved before refactoring begins.

### Phase 2: Consolidate highest-risk domains first

Priority order:

1. Settings
2. Dashboard
3. Reports
4. Backup access model

Actions:

1. Move all active Settings ownership to the modular settings domain.
2. Decide whether Dashboard should live only in `pages/Dashboard.tsx` and remove fallback use of the legacy component.
3. Decide whether Reports should live only in `pages/Reports.tsx` and archive or retire the older Reports component.
4. Decide whether Backup is a standalone business area or only a settings subdomain.

Deliverable:

1. Removal of parallel primary implementations in the highest-risk areas.

### Phase 3: Normalize route aliases

Actions:

1. Choose one canonical route for dashboard.
2. Choose one canonical route for operations.
3. Keep aliases only if there is a business reason, then enforce redirect strategy and document it.

Deliverable:

1. Reduced route-level duplication and clearer analytics surface.

### Phase 4: Flatten wrapper pages where useful

Scope:

1. Formulation
2. Stocktaking
3. Opening Balance
4. Operations if retained as a wrapper

Actions:

1. Either keep wrappers intentionally as route adapters and document them,
2. or move ownership fully to routed pages and reduce deep delegation.

Deliverable:

1. Lower mental overhead for future maintenance.

### Phase 5: Retire or archive non-owner files

Actions:

1. Remove or archive orphaned and misleading page files.
2. Remove unused imports from App.tsx once route ownership is settled.
3. Re-run build and route regression after every consolidation batch.

Deliverable:

1. Cleaner repository tree and lower risk of misdirected fixes.

## Required Safety Rule For Any Future Refactor

Before any later cleanup or consolidation work begins, every file that will be edited must first be copied to a separate backup directory.

Mandatory policy:

1. No in-place architectural cleanup without pre-change file copies.
2. Copies must preserve the original relative path structure where practical.
3. Each cleanup batch should be stored under a timestamped subfolder.

Recommended backup destination:

1. artifacts/phase3/file-backups/<timestamp>/...

Recommended naming example:

1. artifacts/phase3/file-backups/2026-03-26T2200-pre-settings-cleanup/frontend/src/components/Settings.tsx
2. artifacts/phase3/file-backups/2026-03-26T2200-pre-settings-cleanup/frontend/src/modules/settings/pages/Settings.tsx

Reason for the policy:

1. Some older files may still contain recoverable behavior, view logic, text, or integration details useful for reconstruction.
2. Architectural cleanup here is not a safe candidate for blind deletion.

## Suggested Backup Scope For Future Refactor Waves

### Wave A: Settings consolidation

Backup candidates:

1. frontend/src/components/Settings.tsx
2. frontend/src/modules/settings/pages/Settings.tsx
3. frontend/src/modules/settings/components/BackupAndRestore.tsx
4. frontend/src/modules/settings/components/AuditLogs.tsx
5. frontend/src/components/AuditLogs.tsx
6. frontend/src/components/BackupCenter.tsx

### Wave B: Dashboard and Reports consolidation

Backup candidates:

1. frontend/src/components/Dashboard.tsx
2. frontend/src/pages/Dashboard.tsx
3. frontend/src/components/Reports.tsx
4. frontend/src/pages/Reports.tsx

### Wave C: Wrapper simplification

Backup candidates:

1. frontend/src/pages/Operations.tsx
2. frontend/src/components/DailyOperations.tsx
3. frontend/src/pages/Formulation.tsx
4. frontend/src/components/Formulation.tsx
5. frontend/src/pages/Stocktaking.tsx
6. frontend/src/components/Stocktaking.tsx
7. frontend/src/pages/OpeningBalancePage.tsx
8. frontend/src/components/OpeningBalancePage.tsx

### Wave D: Legacy residual cleanup

Backup candidates:

1. frontend/src/pages/BackupCenter.tsx
2. frontend/src/components/ItemManagement.tsx
3. frontend/src/App.tsx

## Recommended Decision Order For External Consultation

The external reviewer should be asked to make decisions in this order:

1. What is the canonical ownership layer for each business section?
2. Should Backup remain a standalone section or be absorbed into Settings only?
3. Should route aliases be retained as product requirements or collapsed into redirects?
4. Should wrapper pages remain as architectural adapters or be flattened after migration?
5. Which legacy files should be archived versus deleted?

## Final Conclusion

The system currently contains meaningful page duplication, but the most important conclusion is that it is a structured migration problem, not random duplication.

The most urgent cleanup target is Settings, followed by Dashboard, Reports, and Backup access topology.

If future cleanup is approved, it should proceed in staged batches with mandatory pre-change file backups into a separate folder before any file is edited.

This report is intended to serve as a single consultation document for:

1. duplication diagnosis
2. ownership clarification
3. cleanup prioritization
4. refactor safety controls