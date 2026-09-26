# MZ.S-ERP — خطة الإصلاح الذرية الكاملة (Remediation Execution Plan)

> **للمحرك Hermes:** هذه خطة تنفيذ فقط. لا تُعدّل ملفات المصدر ولا migrations ولا Docker أثناء إنشاء/مراجعة الخطة. التنفيذ لاحقًا يكون عبر Feature Cards ذرّية، مع RED→GREEN→REFACTOR، واختبارات مستقلة.

**المشروع:** `C:/Users/ireac/Documents/GitHub/MZ.S-ERP`  
**الهدف:** إزالة أو احتواء جميع العيوب المرصودة في تقرير الفحص الذري، مع الحفاظ على معمارية NestJS/Prisma/PostgreSQL/React/Vite القائمة، وجعل ترابط الواجهة/Backend/البيانات/التشغيل قابلًا للتحقق آليًا.

**قيد أساسي:** التشخيص الحالي لا يعني أن كل عيب مؤكد بنفس الدرجة. قبل كل إصلاح يجب إعادة تشغيل reproduction ضيق؛ لا يُحظر إصلاح عيب مؤكد فقط. لا يتم rebuild من الصفر.

**الوضع الحالي المرجعي:** `main` عند `78ad6ab74bbd5c887bf0b7a31c6105496cfa3f99`، مع untracked سابق `SYSTEM_RUN_REPORT_2026-03-28.md` (لا تفترض أنه جديد). آخر فحص فعلي: TypeScript للطرفين/build/Prisma validation/Docker config ناجح؛ Vitest أحمر؛ Runtime غير متاح وقت الفحص.

---

## 1) مصدر الحقيقة وترتيب القرار المعماري

### القرارات المعمارية الثابتة قبل أي card

1. **PostgreSQL + Prisma هي المصدر الرسمي لكل بيانات الأعمال** (Users, Roles, Items, Transactions, Balances, Formulation, Rules, Reference Data, Stocktaking, Partners, Orders, Audit metadata). لا يُعتمد localStorage كقاعدة أعمال.
2. **localStorage يُحصر في preferences وpresentation state** (theme, column widths, last selected tab, unsent non-sensitive UI drafts). لا يخزن password/token/business records/audit evidence.
3. **IndexedDB يُحصر في Offline Queue technical state** فقط..queue entries تحمل idempotency key، ولا تُعد datastore.
4. **كل تغيير رصيد** يمر عبر `TransactionService`/ledger command موحد. لا كتابة مباشرة إلى `Item.currentStock` من CRUD أو sync.，先生 initial stock عبر opening-balance أو stock adjustment transaction.
5. **Prisma decimals** تبقى `Decimal` في Backend. لا تُخزن حسابات المال/الكمية في JavaScript float. API boundary يستخدم decimal string أو fixed-point representation متعاقد عليها.
6. **الوقت** يمر عبر `Clock/TimeService` واحد، مع explicit timezone (`Africa/Cairo` للتقارير السنوية/الشهرية كقرار business، UTC للتخزين).
7. **RBAC** له مصدر واحد: `PermissionCatalog` typed/generated contract، مع migration/seed من نفس المصدر. Frontend لا يملك role fallback نهائيًا.
8. **API** له source of truth واحد؛ لا fallback صامت من `POST /items` إلى `/items/sync` بعد اعتماد contract. fallback مسموح فقط في migration adapter مؤقت بزمن صلاحية محدد.
9. **Backup** يجب أن يكون snapshot كامل أو restore صريح-metadata-only. لا تسمى العملية “Full” إذا كانت ناقصة.
10. **CI** يستخدم workflow واحد/مصدر واحد للاختبارات والـbuild، ويفشل إذا اختبارات Frontend حمراء أو Runtime health غير متحققة.

### معمارية لقطعة رأسية (Spine)

أول slice تنفيذي يجب أن يثبت:

```text
Login → session cookie → bootstrap → create/update item (official API)
→ transaction → computed balance → audit → realtime event → backup
```

لا يبدأ تنفيذ horizontal cleanup قبل نجاح هذا slice على Postgres وBrowser/Service Worker test harness. تمرير كل card لا يعني اكتمال النظام.

---

## 2) سجل العيوب الذري والمستخدم في الخطة

| ID | الخطورة | العيب/الدليل | السبب الجذري المقترح | card/phase |
|---|---|---|---|---|
| F-01 | Critical | `docker-compose.prod.yml:15-29` يستخدم `backend/Dockerfile.prod`; الملف `1-8` Legacy ويستخدم SQLite/PM2 | Deployment graph لا يقود إلى artifact الإنتاجي نفسه | FND-001 |
| F-02 | High | PostgreSQL + localStorage + IndexedDB coexist | ownership غير محدد للبيانات | FND-002/FND-003 |
| F-03 | High | `ItemForm.tsx:126-139` POST/PUT غير موجودة، fallback إلى sync | endpoint contract قديم | API-001 |
| F-04 | High | `sync-items.dto.ts:55-60` و`item.service.ts:48-85` يسمحان direct currentStock | ledger ليست unique write model | INV-001 |
| F-05 | High | `PrismaDataSnapshot` في `backup.service.ts:139-149` لا يغطي كل models | “full backup” غير مكتمل | OPS-001 |
| F-06 | High | Data scope/warehouse غير مفروض server-side | authorization depends on UI state | SEC-001 |
| F-07 | High | `main.yml` Node20 + `ci.yml` Node18; lint continue-on-error; Vitest red | CI source غير واحد | QA-001 |
| F-08 | High | backend permission IDs/front catalog diverge | duplicated permission lists | SEC-002 |
| F-09 | Medium | Multer filename `item.controller.ts:105-112` vs service-generated URL | storage identity split | ITEM-001 |
| F-10 | Medium | Decimal→Number conversions | unsafe boundary contract | DATA-001 |
| F-11 | Medium | local Date + UTC DB boundaries | no canonical clock/timezone | DATA-002 |
| F-12 | High | fire-and-forget audit after business mutation | observability transaction boundary | AUD-001 |
| F-13 | High | legacy authController/fixed helper credentials | old auth surface remains callable/searchable | SEC-003 |
| F-14 | Medium | `backend/src/report` + `backend/src/reports` duplicate modules | unclear ownership | API-002 |
| F-15 | High | stocktaking is localStorage; partners/orders loaded/saved in App from local storage | local business state not server-backed | DATA-003 |
| F-16 | High | health/metrics/E2E unproven in final audit | no always-on runtime gate | QA-002 |
| F-17 | Medium | 4k+ line hotspots, duplicate configs | giant files + unclear boundaries | REF-001 |
| F-18 | Medium | multiple `prisma.config.*` files incl empty nested file | config resolution ambiguous | FND-004 |
| F-19 | Medium | service worker/IndexedDB queue durability not fully proven | offline protocol lacks contract tests | DATA-004 |
| F-20 | High | no formal invariant that stock changes originate from ledger | missing domain invariant | INV-002 |

**Rule:** A finding cannot move to `ACCEPTED` because code compiles. It needs the card’s behavioral test, full regression, runtime proof where applicable, and independent verifier.

---

## 3) Dependency graph and execution order

```text
FND-001 (Production artifact)
  → FND-004 (Prisma config)
    → DATA-001 (decimal contract)
      → INV-001 (stock write invariant)
        → INV-002 (stock adjustment)
          → DATA-002 (clock/timezone)

FND-002 (data ownership ADR)
  → DATA-003 (server-backed domains: stocktaking/partners/orders)
    → DATA-004 (offline queue contract)

SEC-001 (server-side scope)
  → SEC-002 (single permission catalog)
    → SEC-003 (retire legacy auth surface)

API-001 (official item CRUD)
  → API-002 (report ownership)
    → REF-001 (split hotspots)

OPS-001 (complete backup/restore)
  → QA-002 (runtime + E2E proof)
    → QA-001 (single CI gate)
      → CERTIFY
```

**Ready queue is dependency-driven, not line-number-driven.** If a dependency fails, card remains `BLOCKED_BY_CODE`, not silently bypassed.

---

# Phase 0 — Baseline and safety rails (P0)

## FC-FND-001: Production artifact and deployment consistency

**Priority:** P0 · **Requires:** none · **UI:** API-only (deployment safety)

### Full spec
- `docker-compose.prod.yml` must use the maintained non-legacy Backend image definition and run the same compiled app as `docker-compose.yml`.
- Production must not contain SQLite/PM2 fallback. PostgreSQL is the only production datasource.
- Add a machine-readable deployment contract: image build context, Dockerfile path, runtime command, ports, health URL, migration command.
- Legacy file is either renamed/marked unsupported and excluded from deployment, or removed only after git/history reference check.

### Contracts
- `DATABASE_URL` PostgreSQL required in production.
- `GET /api/health` must report db/realtime config readiness without secrets.
- `docker compose config --quiet` and image build must pass.

### Tests (RED first)
1. Static test fails if production compose references a file containing `Legacy`/`DANGER` or `file:./`.
2. Static test fails if production command uses PM2 while canonical runtime uses node.
3. Container smoke: `GET /api/health` returns 200 from built production image.
4. Negative test: no SQLite file is created/required in production container.

### DoD
- Canonical Dockerfile is selected everywhere.
- PostgreSQL migration and health pass in disposable project.
- No tracked `dist`/env/secret is added.
- Evidence log includes actual Docker output and endpoint body.

## FC-FND-004: Single Prisma configuration and schema boundary

**Priority:** P0 · **Requires:** FND-001 · **UI:** API-only

- Keep one documented config path for local/CI/containers.
- Remove empty/duplicate nested configs only after checking scripts/Docker references; otherwise mark unsupported and add validation test.
- All Prisma commands use the same schema path and `DATABASE_URL` resolution.
- Add `prisma validate` + migration status check to baseline.

### Tests
- Red test parses every `prisma.config.*` reference and fails on ambiguous/empty tracked configs.
- Green test runs generate/validate from root and backend with deterministic schema path.
- CI test checks no generated client is committed.

## FC-QA-001: One CI contract and green test gate

**Priority:** P0 · **Requires:** FND-004 · **UI:** API-only

- Consolidate workflow behavior to one Node LTS and one install command.
- Tests are mandatory (`npm test -- --run`), not `continue-on-error`.
- Typecheck Backend and Frontend separately, build full, Prisma validate, compose config.
- Keep E2E in a runtime job, not a false green job that only starts containers and sleeps.

### Tests
- A contract test reads workflows and rejects Node 18/20 drift, ignored lint/test failures, and coverage-only divergence.
- CI simulation script executes every required command and returns nonzero on any failure.

---

# Phase 1 — Data ownership and domain invariants (P0)

## FC-FND-002: Data ownership ADR and state inventory

**Priority:** P0 · **Requires:** none · **UI:** API-only

- Produce a generated inventory of every localStorage/IndexedDB key and every active consumer.
- Classify each as `BUSINESS_SERVER`, `PRESENTATION_PREFERENCE`, `OFFLINE_QUEUE`, `LEGACY_UNSUPPORTED`, or `SECRET_FORBIDDEN`.
- Add a guard test that rejects new business keys in storage without explicit exception.

### Required decisions
- `stocktaking`, `partners`, `orders` become server-backed.
- Theme, language, grid preferences may remain local.
- No password, JWT, credential hash, reset code, or audit record in web storage.
- Legacy data is read once through a migration adapter and then removed from active imports.

## FC-DATA-003: Move stocktaking, partners, orders to PostgreSQL

**Priority:** P0 · **Requires:** FND-002 · **UI:** `/stocktaking`, `/partners`, `/orders`

### Backend
- Add Prisma models/migrations for StocktakingSession, StocktakingEntry, Partner, Order (or existing equivalent if discovered; no duplicate model names).
- Add DTO validation, pagination, audit, permissions, and server-side scope.
- Add idempotent bulk endpoints and explicit close/reconcile operation for stocktaking.

### Frontend
- Replace `monthlyStocktakingService` localStorage reads/writes with API service.
- Replace `App.tsx` `getPartners/savePartners/getOrders/saveOrders` local state persistence with server services.
- Keep temporary local draft only for unsent UX state; do not treat it as committed data.

### Migration
- Versioned one-time importer keyed by device/user/month; idempotency table prevents duplicate rows.
- Export before migration; dry-run summary; rollback strategy documented.

### Tests
- API integration: create/list/close/reopen stocktaking; partner/order CRUD; permission denial; scope denial.
- E2E: two browser contexts cannot see each other’s data; refresh survives server restart.
- Migration idempotency property test: same snapshot imported twice yields same row count.

## FC-DATA-001: Decimal-safe API contract

**Priority:** P0 · **Requires:** FND-004 · **UI:** item/transaction/report screens

- Define decimal boundary type (recommend strings, e.g. `DecimalString = /^-?\d+(\.\d{1,3})?$/`) and use it in DTOs/OpenAPI/Frontend types.
- Backend parses through `Prisma.Decimal`, not `Number`.
- Money/quantity calculations use Decimal or integer scaled units; never JS float accumulation.
- Enforce scale and max values centrally.

### Tests
- Values such as `0.1 + 0.2`, `999999999.999`, negative/too-many-scale inputs.
- API round-trip does not lose precision.
- Ledger balance invariant: `net = inbound + returns + production - outbound - waste` for randomized deterministic fixtures.

## FC-INV-001: Single stock write model

**Priority:** P0 · **Requires:** DATA-001 · **UI:** item + operations screens

- Remove `currentStock` from ordinary item create/update DTOs.
- `syncItems` is metadata sync only; it must not write stock.
- Opening inventory uses explicit opening-balance or stock-adjustment command with reason, actor, timestamp, and audit.
- `currentStock` is updated only inside the same Prisma transaction as the ledger command, with optimistic/concurrency guard where needed.
- Existing direct-stock callers get a compatibility rejection with migration instructions, not silent behavior change.

### Tests
- POST/PUT item with stock field is rejected by contract.
- sync cannot change stock.
- transaction increments/decrements stock exactly once.
- crash/failure between ledger and stock update leaves both unchanged.
- two concurrent transactions cannot lose update.

## FC-INV-002: Stock adjustment and reconciliation command

**Priority:** P1 · **Requires:** INV-001 · **UI:** operations/audit

- Add explicit `STOCK_ADJUSTMENT` operation, reason, approval/permission policy, and source reference.
- Reports and balances derive from ledger; item currentStock is a cache/check, never the authority.
- Add reconciliation report comparing cache and ledger.

## FC-DATA-002: Canonical clock and timezone

**Priority:** P1 · **Requires:** INV-001 · **UI:** reports/opening balance/stocktaking

- Inject `Clock`/`TimeService`; prohibit direct `new Date()` in business calculations.
- Store UTC; business period boundaries use configured `Africa/Cairo` timezone.
- Add DST/month-boundary tests and deterministic fixed clock.

## FC-DATA-004: Offline queue protocol and durability

**Priority:** P1 · **Requires:** FND-002 + API-001 · **UI:** offline banner/retry UI

- Queue mutation has `idempotencyKey`, entity, operation, payload version, attempts, nextRetryAt, lastError, createdAt.
- Server endpoints support idempotency and return canonical result.
- Queue is never considered committed; UI displays pending/conflict/failed states.
- Add retry/backoff, max attempts, dead-letter/manual retry, replay after auth/scope changes, and storage quota handling.
- Service worker must not cache authenticated API responses or auth mutations.

---

# Phase 2 — API, identity, and security contracts (P0/P1)

## FC-API-001: Official Items CRUD contract

**Priority:** P0 · **Requires:** FND-004 + DATA-001 · **UI:** item catalog/form

- Decide canonical REST endpoints: `POST /items`, `PUT /items/:publicId` (or documented PATCH) and add corresponding DTO/controller/service.
- Remove silent fallback from ItemForm after migration; keep a versioned adapter only if existing clients need it, with sunset metric and tests.
- Return `{ data, meta }` or current agreed envelope consistently.
- Reject fields not in DTO; do not map UI-only fields silently to `description`.

### Tests
- Create/read/update/round-trip all canonical fields.
- Invalid/extra fields rejected.
- Contract test compares frontend calls to registered backend routes.
- 404/405/501 fallback is removed or explicitly tested as temporary adapter.

## FC-SEC-001: Server-side data scope and warehouse isolation

**Priority:** P0 · **Requires:** FND-002 + API-001 · **UI:** all data screens

- Backend obtains scope/warehouse from authenticated user/role, never trusts body/query scope.
- Add `where`/join filters to every list, read, write, aggregate, export, realtime subscription, and backup access path.
- Default deny for missing scope; superadmin explicit global scope.
- Add authorization matrix generated from the catalog.

### Tests
- User A cannot GET/PUT/export/realtime-subscribe user B’s data.
- Query tampering (`warehouseId=all`) cannot elevate.
- Negative tests for every controller path, report filter, and socket event.

## FC-SEC-002: Single permission catalog and RBAC contract

**Priority:** P0 · **Requires:** SEC-001 · **UI:** sidebar, routes, settings IAM

- Create backend-owned typed permission catalog (ID, module, action, description).
- Generate frontend catalog/types from it or validate it in CI; no hand-maintained divergent list.
- Decide migration for old role names/aliases; reject unknown permission strings.
- Server remains enforcement source; frontend only hides/disables controls.

### Tests
- Every backend `@Permissions` value exists in catalog.
- Every catalog permission has a route/control owner or explicit API-only reason.
- User/sidebar/route/API use the same matrix.
- Unknown role/permission migration tests.

## FC-SEC-003: Remove legacy authentication surface and secrets

**Priority:** P0 · **Requires:** SEC-002 · **UI:** login/setup/invitation

- Keep JWT HttpOnly cookie + server session as only auth authority.
- Quarantine/remove `frontend/src/services/authController.ts` from active import graph; migrate setup/admin bootstrap to server endpoints.
- Remove fixed credentials from scripts/seed/E2E or use environment-injected test credentials generated at CI runtime.
- Add secret scanner gate; never print secret values.

### Tests
- No active source imports local credential store.
- Browser storage contains no token/password/hash/reset secret after login/logout.
- Production startup fails for missing/weak secrets.
- Login/logout/session revoke/invitation/2FA tests against real server.

## FC-AUD-001: Durable audit boundary

**Priority:** P1 · **Requires:** INV-001 + API-001 · **UI:** audit logs

- Persist audit in the same DB transaction as the business mutation, or use an outbox with durable retry.
- Every privileged/state-changing command emits action, actor, target, before/after metadata (redacted), request ID, result.
- No `void auditService.log...` for security/financial mutations.
- Add retention/export/search and immutable policy.

### Tests
- Simulated audit failure does not leave unlogged committed financial mutation.
- Search/filter/limit/export contract tests.
- Redaction tests for passwords, tokens, reset PINs, secrets.

## FC-ITEM-001: Attachment filename and storage integrity

**Priority:** P1 · **Requires:** API-001 · **UI:** item attachments

- Multer-generated filename is the single identity returned/persisted.
- Normalize/validate extension and MIME; enforce size/type; sanitize original name.
- Store path relative to configured upload root, prevent traversal, handle cleanup on DB failure.
- Test image/file upload, download URL, non-image rejection, traversal attempt, failure cleanup.

---

# Phase 3 — Backup, reports, and domain completeness (P0/P1)

## FC-OPS-001: Complete full backup and restore

**Priority:** P0 · **Requires:** FND-002 + FND-004 · **UI:** backup center

- Expand `PrismaDataSnapshot` to all durable business/audit/config tables, including formulations, rules, reference data, audit logs, invitations, sessions (or explicitly exclude session data with documented semantics).
- Add foreign-key-safe ordering and restore transaction/chunk strategy.
- Add manifest model/table counts, schema version, app version, checksum per section, and migration compatibility.
- Safety snapshot before destructive restore; preview diff; one-time token; role/PIN controls; audit restore actions.
- Define whether attachments/config/DB dump are included in “full”.

### Tests
- Seed every model with distinguishable records; backup; restore into empty DB; compare counts, relations, and hashes.
- Missing/extra model fails completeness gate.
- Corrupt checksum, wrong schema version, expired token, unauthorized restore, partial restore rollback.
- Attachment inclusion/exclusion contract test.

## FC-API-002: Report module ownership and contracts

**Priority:** P1 · **Requires:** API-001 + DATA-001 · **UI:** `/reports`

- Select one canonical report module; archive the other behind explicit compatibility boundary.
- Consolidate DTOs, service, controller, rendering, and report configuration.
- Ensure report aggregates use same Decimal/timezone/scope/ledger rules.
- Add report contract tests for empty, large, Arabic, negative, archived, and cross-scope data.

## FC-REF-001: Split hotspots without changing behavior

**Priority:** P2 · **Requires:** all P0 contracts green · **UI:** existing screens

- Split `DailyOperations.tsx`, `useInventoryStore.ts`, `backup.service.ts`, `users.service.ts`, `transaction.service.ts`, `item.service.ts` by domain/use-case.
- Do not mix refactor with behavior changes; characterization tests first.
- Keep public API exports stable during extraction.
- Add module dependency boundaries and lint/architecture checks.

---

# Phase 4 — Runtime proof, E2E, and certification

## FC-QA-002: Disposable runtime and real E2E proof

**Priority:** P0 · **Requires:** OPS-001 + API-001 + SEC-001 · **UI:** all flows

- Start Postgres + Backend + Frontend using canonical compose path.
- Wait for actual readiness, not fixed sleep.
- Execute real HTTP: health, metrics auth/unauth, login, cookie, bootstrap, item, transaction, balance, audit, backup, restore, logout.
- Execute browser E2E for login → item → transaction → report → stocktaking → settings/RBAC.
- Verify Service Worker/offline path with a controlled network interruption.

### Proof artifacts (not claims)
- HTTP status + response body.
- DB row counts before/after.
- Test names and individual pass/fail.
- Browser console/network errors.
- Container logs and health transition.

## FC-CERTIFY-001: Final production certification

**Priority:** P0 · **Requires:** all cards above except optional refactors · **UI:** N/A

- All P0/P1 cards `ACCEPTED` by independent verifier.
- `npm test -- --run`, both tsc projects, build full, Prisma validate, compose config, full runtime/E2E all green.
- No tracked secrets, no generated artifacts, no active legacy import, no direct stock writes, no backup completeness failure.
- Independent Devil’s Advocate run attacks stock invariants, auth scope, restore safety, API drift, timezone, precision, and offline replay.
- Production can be called ready only with actual evidence; a green card count alone is insufficient.

---

## 4) Execution ledger (machine-readable status to create before code changes)

Before first code card, create the following durable files under the project’s chosen plan/registry location (not yet created here because this task is planning-only):

```yaml
# EXECUTION_LEDGER.yaml
cycle: 1
mode: autonomous
phase: bootstrap
last_card_completed: null
next_card: FND-001
blocked: false
obstacles: []
spine_order:
  - FND-001
  - FND-004
  - DATA-001
  - INV-001
  - API-001
  - SEC-001
  - SEC-002
  - SEC-003
  - OPS-001
  - QA-002
completed: 0
total_planned: 20
```

Each transition must update both ledger and human board. If conflict: ledger wins. No card moves to `VERIFIED` based on implementation self-report.

## 5) Card acceptance rules

- **RED:** test fails for the intended missing/wrong behavior.
- **GREEN:** smallest fix passes the focused test.
- **REFACTOR:** full targeted suite and typecheck remain green.
- **DEVIL’S ADVOCATE:** malformed input, concurrency, replay, scope escalation, restore corruption, and crash boundary tested.
- **STRANGER TEST:** a fresh worker can implement the card from the standalone card and exact file paths.
- **Evidence:** commit SHA, command, exit code, response body, test count, verifier identity.
- **No fabricated claims:** no `ACCEPTED`, `100%`, or “Production ready” without actual output.

### Atomic-card contract (binding for every FC)

Every card must contain these standalone sections before implementation:

- **Full spec** — behavior, boundaries, and worked input/output.
- **Contracts** — DTO/event/database/route contracts.
- **Binding warnings** — forbidden shortcuts and dependencies on later cards.
- **Test skeleton** — copy-pasteable RED tests.
- **Evidence log** — empty until execution; never backfill claims.
- **Definition of Done** — mechanical checklist.
- **UI** — screen, API-only reason, or headless reason.
- **Transport handoff (`مذكرة النقل`)** — the hidden design reason a fresh worker must not lose.

**Transport handoff rule:** the final section of every standalone card is titled `مذكرة النقل` and explains why the design choice exists. This is a required transport contract, not optional prose.

## 6) Recommended first execution batch (not performed by this plan)

1. Create execution ledger/cards and baseline report from current files.
2. Fix FND-001/FND-004 in the smallest safe surface; do not touch domain behavior.
3. Fix F-07 test environment/storage setup and get the existing suite green.
4. Implement the vertical spine with tests: login → item → transaction → balance → audit.
5. Only after spine passes, execute data ownership, backup, scope, and certification cards.

## 7) Plan self-check

- [x] Every reported defect has an ID and remediation phase.
- [x] High/critical risks are ordered before medium refactors.
- [x] API/data/security/backup dependencies are explicit.
- [x] TDD and runtime proof are mandatory.
- [x] No source file, migration, branch, or Docker file was changed by this planning turn.
- [x] Current Git state remains: only pre-existing `?? SYSTEM_RUN_REPORT_2026-03-28.md`.
