# APPROVED_CORRECTED_EXECUTION_PLAN

- Generated: 2026-04-20 21:50:00 local
- Status: approved for controlled implementation
- Decision: GO, with corrections and sequencing gates
- Supersedes: raw external-agent proposal for request-storm remediation
- Scope: request-storm stabilization, auth/session correctness, bootstrap orchestration, bounded loading, backend protection tuning, audit hot-path reduction
- Code Changes Performed By This Document: none

## Purpose

This document is the corrected execution plan that should be used if the team proceeds with implementation.

It is derived from:

1. `audit-reports/surgical/20260420-212544/CURRENT_RUNTIME_AUTH_REQUEST_STORM_REPORT.md`
2. `audit-reports/surgical/20260420-212544/OTHER_AGENT_PROPOSAL_COMPARISON_REPORT.md`

This plan keeps the technically sound parts of the earlier proposal and removes or downgrades the parts that are either stack-inappropriate, architecturally imprecise, or operationally wasteful.

## Executive Approval Statement

I approve implementation of a corrected phased fix.

I do not approve implementation of the other agent's proposal as written.

The mandatory engineering stance is:

- stabilize first
- correct the auth model second
- fix the security defect immediately after
- introduce bootstrap orchestration deliberately
- tune backend protection after the frontend storm is eliminated

## Non-Negotiable Constraints

1. No broad rewrite before stabilization.
2. No permanent diagnostic tooling in production bundles unless it produces durable operational value.
3. No wildcard permission fallback for non-admin users.
4. No page-mount global `loadAll()` calls on hot routes.
5. No naming such as `ModernBootstrapService`; names must describe responsibility.
6. No XML-style documentation requirement in this TypeScript/Nest/React codebase.

## Execution Prerequisites

These steps are required at the beginning of implementation, not at plan-review time.

### Pre-Execution Step 0

Create a full ZIP backup named exactly:

`Backup_Before_Fix_RequestStorm_2026-04-20.zip`

This backup is an operational safeguard, not an architectural feature.

### Pre-Execution Step 1

Capture a fresh baseline before making changes:

1. backend metrics snapshot
2. login success/failure flow
3. request counts for bootstrap-related routes
4. rerender evidence in the application shell

### Pre-Execution Step 2

Confirm the exact impacted files before editing:

- `frontend/src/App.tsx`
- `frontend/src/hooks/useSession.ts`
- `frontend/src/hooks/usePermissions.ts`
- `frontend/src/store/useInventoryStore.ts`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/Items.tsx`
- `frontend/src/pages/Operations.tsx`
- `frontend/src/pages/Reports.tsx`
- `backend/src/security/global-rate-limit.ts`
- `backend/src/users/users.service.ts`

## Approved Target State

The approved end-state is:

1. Session restoration is isolated from mutable domain collections.
2. The application shell has a single bootstrap orchestrator.
3. Page components do not trigger full-application synchronization on mount.
4. Permissions are derived from a real session source of truth.
5. Non-admin users never receive wildcard fallback permissions.
6. Backend protections are layered by traffic class rather than using a blunt one-policy model.
7. High-frequency read endpoints do not emit unnecessary persistent audit writes.

## Approved Phases

## Phase 0 – Baseline Instrumentation

Objective: measure the fix without polluting production behavior.

### Approved Work

1. Add `bootstrap_duration_ms` and `bootstrap_request_count` for the startup flow.
2. Add temporary render diagnostics for the shell/bootstrap path only.
3. Use React Profiler in development when validating rerender reduction.

### Not Approved As Written

1. Permanent `why-did-you-render` as part of the production remediation.
2. Any instrumentation that remains in the production bundle without strong justification.

### Implementation Rule

If `why-did-you-render` is added, it must be:

1. development-only
2. isolated behind environment gating
3. removable after verification

### Exit Criteria

1. baseline rerender evidence captured
2. baseline bootstrap duration captured
3. baseline bootstrap request count captured

## Phase 1 – Immediate Stabilization

Objective: stop the request storm with the smallest high-confidence architecture correction.

### Approved Work

1. Remove `users` from the auth initialization effect dependencies in `frontend/src/App.tsx`.
2. Ensure `initializeAuth` runs once per session-restore cycle rather than per store mutation.
3. Remove automatic page-mount `loadAll()` calls from:
   - `frontend/src/pages/Dashboard.tsx`
   - `frontend/src/pages/Items.tsx`
   - `frontend/src/pages/Operations.tsx`
   - `frontend/src/pages/Reports.tsx`
4. Keep only explicit manual refresh actions.
5. Remove or dev-gate render-path Permission Guard logs.

### Design Rule

This phase must be intentionally narrow. Do not mix it with broader store refactors unless required to stop the storm.

### Exit Criteria

1. no repeated bootstrap route flood after login
2. 429 responses disappear from normal login/navigation flow
3. Permission Guard console spam is removed or reduced to controlled dev-only diagnostics

## Phase 2 – Correct Authentication State Model

Objective: establish a single source of truth for authenticated session state.

### Approved Work

1. Redesign `frontend/src/hooks/useSession.ts` to represent the real session model.
2. Make `frontend/src/hooks/usePermissions.ts` derive `isAuthenticated` from that real session model.
3. Align protected-route logic and shell state with the same session contract.
4. Remove dependence on fake or empty token placeholders.

### Design Rule

The session source of truth should be compatible with the actual cookie-backed authentication behavior already in the backend.

### Exit Criteria

1. `useSession` and `usePermissions` agree on auth state
2. auth state survives session restore predictably
3. non-SuperAdmin flows behave correctly

## Phase 3 – Remove Wildcard Permission Defect

Objective: eliminate implicit privilege escalation.

### Approved Work

1. Fix the fallback in `frontend/src/App.tsx` so non-admin users receive `[]`, not `['*']`.
2. Treat missing permissions as incomplete permission state, not universal access.

### Design Rule

This is a security fix and should be treated as such.

### Exit Criteria

1. non-admin fallback permissions are empty
2. SuperAdmin/admin fallback remains explicit and intentional only where justified

## Phase 4 – Rebuild Bootstrap Orchestration Boundary

Objective: move bootstrap responsibility out of the overloaded application shell.

### Approved Work

1. Create `frontend/src/hooks/useAppBootstrap.ts`.
2. Create a backend bootstrap service with a responsibility-based name.
3. Add a minimal backend endpoint: `/api/app/bootstrap`.

### Approved Naming

Use one of the following:

1. `AppBootstrapService`
2. `ApplicationBootstrapService`

### Rejected Naming

1. `ModernBootstrapService`

### Contract Scope For `/api/app/bootstrap`

The endpoint should return only what is required to stabilize the shell and first authenticated view, for example:

1. current user session payload
2. resolved permissions
3. minimal inventory/reference metadata
4. startup flags needed by the shell

### Explicit Non-Goal

The endpoint must not become a monolithic "return the whole application state" endpoint.

### Exit Criteria

1. `App.tsx` no longer owns full bootstrap choreography
2. initial session + shell bootstrap runs through a dedicated orchestration layer

## Phase 5 – Replace `loadAll()` with Bounded Loaders

Objective: move from coarse global loading to explicit bounded synchronization.

### Approved Work

1. Split `loadAll()` into domain-specific loaders.
2. Introduce stale checks before refetching.
3. Use selective Zustand subscriptions, including shallow selection where it materially reduces rerenders.
4. Keep a full reload capability only for explicit operational refresh scenarios.

### Recommended Loader Set

1. `loadInventoryCore()`
2. `loadTransactions()`
3. `loadUsersAndRoles()`
4. `loadOpeningBalances(year)`
5. `loadFormulations()`

### Implementation Rule

Do this incrementally. Start with the loaders needed for the hot bootstrap path.

### Exit Criteria

1. route pages only fetch their own bounded data needs
2. shell bootstrap no longer triggers unnecessary module-wide reloads
3. store updates become easier to reason about and test

## Phase 6 – Improve Backend Protection Without Overreaction

Objective: keep protection strong after the frontend storm is fixed.

### Approved Work

1. Keep a coarse global limiter as a fallback safety layer.
2. Add more precise limiters by traffic class:
   - login/auth endpoints
   - bootstrap endpoints
   - authenticated read endpoints where appropriate
3. Add per-session or per-principal limiting where it improves isolation.

### Conditionally Approved Work

1. Circuit breaker behavior for bootstrap paths only if post-fix measurements justify it.

### Not Approved As Written

1. Full immediate replacement of the global limiter before frontend stabilization is proven.

### Exit Criteria

1. normal login/bootstrap flows are not penalized by blunt limiter behavior
2. abusive or pathological repeated traffic is still controlled

## Phase 7 – Reduce Audit Load On Hot Read Paths

Objective: remove avoidable write amplification from high-frequency read operations.

### Approved Work

1. Remove persistent audit writes from `listUsers` and `listRoles` unless a compliance rule explicitly requires them.
2. Replace them with counters or telemetry if observability is still needed.

### Exit Criteria

1. read-heavy user/role paths no longer create unnecessary audit writes
2. mutation and security-significant audit coverage remains intact

## Documentation and Commenting Policy

### Approved

1. concise TSDoc/JSDoc where public APIs or non-obvious orchestration needs explanation
2. structured logging where it materially improves operations
3. targeted tests for stabilized behavior

### Rejected

1. blanket XML documentation requirement
2. ceremonial comments on every function and variable
3. logging added everywhere without operational purpose

## Testing Strategy

This defect requires more than unit tests.

### Required Test Coverage

1. integration validation for login plus bootstrap
2. route-level runtime verification after login
3. metrics comparison before and after the fix
4. permission regression checks for non-admin users

### Useful Test Additions

1. an end-to-end smoke test that logs in and verifies no request storm occurs
2. a session bootstrap integration test against `/api/app/bootstrap`

## Acceptance Criteria

The implementation is accepted only if all items below are true:

1. fresh login does not produce 429 responses under normal navigation
2. bootstrap route count is bounded and stable
3. shell rerender count is materially lower than baseline
4. Permission Guard spam is eliminated from the runtime path
5. `useSession` and `usePermissions` agree on authenticated state
6. non-admin users never receive wildcard fallback permissions
7. page mount no longer triggers full global data synchronization
8. users/roles read paths no longer generate unnecessary audit writes
9. backend protection still blocks abusive patterns after frontend stabilization

## Files Expected To Change During Implementation

### Frontend

1. `frontend/src/App.tsx`
2. `frontend/src/hooks/useSession.ts`
3. `frontend/src/hooks/usePermissions.ts`
4. `frontend/src/hooks/useAppBootstrap.ts` (new)
5. `frontend/src/store/useInventoryStore.ts`
6. `frontend/src/pages/Dashboard.tsx`
7. `frontend/src/pages/Items.tsx`
8. `frontend/src/pages/Operations.tsx`
9. `frontend/src/pages/Reports.tsx`

### Backend

1. `backend/src/security/global-rate-limit.ts`
2. `backend/src/users/users.service.ts`
3. bootstrap module/service/controller files for `/api/app/bootstrap`

## Implementation Order Approved For Execution

1. create backup ZIP
2. capture baseline metrics and rerender evidence
3. Phase 1 stabilization
4. Phase 2 session correction
5. Phase 3 security fallback fix
6. Phase 4 bootstrap orchestration boundary
7. Phase 5 bounded loaders
8. Phase 7 audit hot-path reduction
9. Phase 6 backend protection tuning
10. final before/after measurements and acceptance report

## Final Principal-Level Instruction

If implementation begins, it should begin from this plan, not from the raw external-agent request.

This plan is strict where correctness matters and intentionally rejects decorative engineering that does not improve the operational outcome.
