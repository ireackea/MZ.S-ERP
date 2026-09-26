/**
 * FC-API-002 — report module ownership.
 *
 * The repository previously carried two `reports` modules that both mounted
 * `@Controller('reports')` and each carried its own movement classifier, so the
 * same question ("is this row inbound?") had three different answers.
 *
 * Ownership is now split explicitly:
 *
 *   `backend/src/report/`   (CANONICAL — data and aggregation)
 *     - owns `GET  /api/reports`            filtered transactions
 *     - owns `POST /api/reports/generate`    typed aggregates
 *     - owns `POST /api/render-pdf`          HTML→PDF for the above
 *     - owns the reporting DTOs
 *
 *   `backend/src/reports/`  (COMPATIBILITY SHIM — printing only)
 *     - owns `POST /api/reports/print`       print a client-supplied view
 *     - performs no database access and no aggregation
 *
 * Rules that must hold (enforced by `scripts/audit/tests/api-002-contract.test.mjs`):
 *   1. Only `report/` may query Prisma or classify movement for aggregates.
 *   2. `reports/` must not import PrismaService, and must not re-derive direction.
 *   3. Movement classification is defined exactly once, in
 *      `common/operation-type.ts`, driven by `common/operation-type-aliases.ts`.
 *   4. Both modules reuse `TimeService` and `warehouseScopeCondition`; neither
 *      builds its own date or scope logic.
 */
