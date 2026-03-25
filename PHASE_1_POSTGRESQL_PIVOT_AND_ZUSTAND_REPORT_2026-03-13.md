# PHASE 1 - PostgreSQL Pivot + Zustand Single Source of Truth

Date: 2026-03-13
Workspace: MZ.S-ERP

## Executive Summary

Phase 1 was applied on top of the secured backend baseline.

Validated items:

- Docker CLI is available in the current PowerShell session after extending `PATH`.
- Prisma remains configured for PostgreSQL through `env("DATABASE_URL")` in [backend/prisma/schema.prisma](backend/prisma/schema.prisma#L9).
- Compose PostgreSQL credentials are set to `feedfactory / SecurePassword2026!` in [docker-compose.yml](docker-compose.yml#L9).
- `.env.example` already contains the required PostgreSQL connection string in [.env.example](.env.example#L1).
- `frontend/src/App.tsx` no longer hydrates inventory-backed state from local storage helpers for units, categories, settings, formulas, unloading rules, or report configuration.
- `frontend/src/store/useInventoryStore.ts` keeps the inventory domain server-first through `loadAll()` and `syncFromServer()` without `persist()` or local storage fallbacks.

## Modified Files

- [frontend/src/App.tsx](frontend/src/App.tsx)
- [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts)

## Zustand Single Source Of Truth Confirmation

The inventory domain now uses Zustand as the single source of truth for server-backed data.

Evidence:

- `loadAll()` performs a server-first load for items, transactions, opening balances, and users in [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts#L83) and [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts#L395).
- `syncFromServer()` supports targeted refresh by data type in [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts#L85) and [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts#L413).
- No `persist()` middleware exists in [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts).
- No `localStorage` fallback exists in [frontend/src/store/useInventoryStore.ts](frontend/src/store/useInventoryStore.ts).
- `App.tsx` no longer seeds inventory reference/config data from storage helpers during auth bootstrap in [frontend/src/App.tsx](frontend/src/App.tsx#L157).
- All application routes remain wrapped through `ProtectedRoute` via `renderProtectedRoute()` in [frontend/src/App.tsx](frontend/src/App.tsx#L622).
- `clearAllAuthData()` is invoked in the post-login synchronization effect and login handler in [frontend/src/App.tsx](frontend/src/App.tsx#L248) and [frontend/src/App.tsx](frontend/src/App.tsx#L486).

## Docker CLI Verification

```text
Docker version 29.3.0, build 5927d80
```

## Docker Compose Result

The current Phase 1 Docker run succeeded overall, with a transient initial PostgreSQL reachability failure on the first backend boot attempt, followed by automatic container restart, successful Prisma sync/seed, and final Nest startup.

Confirmed runtime state after startup:

```text
NAMES                STATUS          PORTS
mzs-erp-frontend-1   Up 15 minutes   0.0.0.0:4173->4173/tcp, [::]:4173->4173/tcp
mzs-erp-backend-1    Up 15 minutes   0.0.0.0:3001->3001/tcp, [::]:3001->3001/tcp
mzs-erp-postgres-1   Up 15 minutes   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp
```

### `docker compose up --build` - first 100 lines

```text
time="2026-03-25T17:27:56+02:00" level=warning msg="C:\Users\ireac\Documents\GitHub\MZ.S-ERP\docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion"
 Image mzs-erp-backend Building
 Image mzs-erp-frontend Building
#1 [internal] load local bake definitions
#1 reading from stdin 1.05kB done
#1 DONE 0.0s

#2 [backend internal] load build definition from Dockerfile
#2 transferring dockerfile: 747B done
#2 DONE 0.0s

#3 [frontend internal] load build definition from Dockerfile
#3 transferring dockerfile: 572B 0.0s done
#3 DONE 0.0s

#4 [backend internal] load metadata for docker.io/library/node:20-bookworm-slim
#4 ...

#5 [auth] library/nginx:pull token for registry-1.docker.io
#5 DONE 0.0s

#6 [auth] library/node:pull token for registry-1.docker.io
#6 DONE 0.0s

#7 [frontend internal] load metadata for docker.io/library/nginx:alpine
#7 ...

#4 [backend internal] load metadata for docker.io/library/node:20-bookworm-slim
#4 DONE 1.7s

#8 [backend internal] load .dockerignore
#8 transferring context: 189B 0.0s done
#8 DONE 0.0s

#9 [frontend internal] load metadata for docker.io/library/node:20-alpine
#9 DONE 1.7s

#10 [backend  1/12] FROM docker.io/library/node:20-bookworm-slim@sha256:1e85773c98c31d4fe5b545e4cb17379e617b348832fb3738b22a08f68dec30f3
#10 resolve docker.io/library/node:20-bookworm-slim@sha256:1e85773c98c31d4fe5b545e4cb17379e617b348832fb3738b22a08f68dec30f3 0.0s done
#10 DONE 0.0s

#11 [backend  2/12] WORKDIR /app
#11 CACHED

#7 [frontend internal] load metadata for docker.io/library/nginx:alpine
#7 DONE 1.8s

#12 [backend  3/12] RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
#12 ...

#13 [frontend internal] load .dockerignore
#13 transferring context: 153B 0.0s done
#13 DONE 0.0s

#14 [backend internal] load build context
#14 transferring context: 7.31kB 0.1s done
#14 DONE 0.1s

#12 [backend  3/12] RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
#12 ...

#15 [frontend stage-1 1/3] FROM docker.io/library/nginx:alpine@sha256:e7257f1ef28ba17cf7c248cb8ccf6f0c6e0228ab9c315c152f9c203cd34cf6d1
#15 resolve docker.io/library/nginx:alpine@sha256:e7257f1ef28ba17cf7c248cb8ccf6f0c6e0228ab9c315c152f9c203cd34cf6d1 0.1s done
#15 DONE 0.1s

#16 [frontend builder 1/6] FROM docker.io/library/node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa
#16 resolve docker.io/library/node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa 0.1s done
#16 DONE 0.1s

#17 [frontend internal] load build context
#17 transferring context: 82.00kB 0.2s done
#17 DONE 0.2s

#18 [frontend builder 2/6] WORKDIR /app
#18 CACHED

#19 [frontend builder 3/6] COPY package*.json ./
#19 CACHED

#20 [frontend builder 4/6] RUN npm ci
#20 CACHED

#21 [frontend builder 5/6] COPY . .
#21 DONE 0.5s

#12 [backend  3/12] RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
#12 2.320 Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]
#12 2.534 Get:2 http://deb.debian.org/debian bookworm-updates InRelease [55.4 kB]
#12 2.597 Get:3 http://deb.debian.org/debian-security bookworm-security InRelease [48.0 kB]
#12 2.726 Get:4 http://deb.debian.org/debian bookworm/main amd64 Packages [8792 kB]
#12 ...

#22 [frontend builder 6/6] RUN npm run build
#22 1.553
#22 1.553 > @feedfactory/frontend@0.0.0 build
#22 1.553 > tsc && vite build
#22 1.553
#22 ...

#12 [backend  3/12] RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
#12 14.20 Get:5 http://deb.debian.org/debian bookworm-updates/main amd64 Packages [6924 B]
#12 14.21 Get:6 http://deb.debian.org/debian-security bookworm-security/main amd64 Packages [294 kB]
#12 18.00 Fetched 9347 kB in 16s (592 kB/s)
#12 18.00 Reading package lists...
#12 19.18 Reading package lists...
#12 19.94 Building dependency tree...
#12 20.10 Reading state information...
#12 20.32 The following additional packages will be installed:
#12 20.32   libssl3
#12 20.41 The following NEW packages will be installed:
#12 20.41   ca-certificates libssl3 openssl
#12 ...

#22 [frontend builder 6/6] RUN npm run build
#22 19.21 vite v5.4.21 building for production...
#22 19.34 transforming...
#22 ...

#12 [backend  3/12] RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
#12 20.64 0 upgraded, 3 newly installed, 0 to remove and 0 not upgraded.
#12 20.64 Need to get 3617 kB of archives.
#12 20.64 After this operation, 8928 kB of additional disk space will be used.
#12 20.64 Get:1 http://deb.debian.org/debian-security bookworm-security/main amd64 libssl3 amd64 3.0.18-1~deb12u2 [2030 kB]
#12 22.10 Get:2 http://deb.debian.org/debian-security bookworm-security/main amd64 openssl amd64 3.0.18-1~deb12u2 [1433 kB]
#12 22.98 Get:3 http://deb.debian.org/debian bookworm/main amd64 ca-certificates all 20230311+deb12u1 [155 kB]
#12 24.56 debconf: delaying package configuration, since apt-utils is not installed
#12 25.37 Fetched 3617 kB in 3s (1353 kB/s)
#12 25.51 Selecting previously unselected package libssl3:amd64.
#12 25.51 (Reading database ...
```

### `docker compose up --build` - last 50 lines

```text
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/opening-balances/:year, GET} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/opening-balances/bulk, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] ItemController {/api/items}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/items/sync, POST} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/items/delete, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/items/generate-codes, POST} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/items, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] MonitoringController {/api}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/health, GET} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/admin/reset-system, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/logs, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] ReportController {/api/reports}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/reports, GET} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/reports/generate, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] ReportController {/api/reports}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/reports/print, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] TransactionController {/api/transactions}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions, GET} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/:id, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/bulk, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/bulk-import, POST} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/migrate-from-local, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/:id, PATCH} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/:id, PUT} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/:id, DELETE} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/transactions/delete, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] BalancesController {/api/balances}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/balances/computed, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] UsersController {/api/users}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/permissions/me, GET} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/roles, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/roles, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/roles/:id/permissions, PUT} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/stream, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/invite, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/invite/verify, POST} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/invite/accept, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/:id, PUT} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/:id, DELETE} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/:id/lock, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/bulk/assign-role, POST} route +1ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/bulk/delete, POST} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/users/:id/audit, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RoutesResolver] DashboardController {/api/dashboard}: +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:35 PM     LOG [RouterExplorer] Mapped {/api/dashboard/stats, GET} route +0ms
backend-1   | [Nest] 157  - 03/25/2026, 3:37:36 PM     LOG [NestApplication] Nest application successfully started +468ms
backend-1   | Backend (Nest) listening on port 3001
```

## `npm run build:full` Result

Status: Passed

```text
> feedfactory-pro@0.0.0 build:full
> npm run frontend:build && npm run backend:build

vite v5.4.21 building for production...
✓ 3551 modules transformed.
...
✓ built in 51.15s

> @feedfactory/backend@0.0.0 build
> tsc -p tsconfig.json
```

## Dashboard Screenshots After Login

Fresh Phase 1 screenshots were generated in:

- [artifacts/phase1/dashboard.png](artifacts/phase1/dashboard.png)
- [artifacts/phase1/reports.png](artifacts/phase1/reports.png)
- [artifacts/phase1/daily-operations.png](artifacts/phase1/daily-operations.png)
- [artifacts/phase1/daily-operations-offline.png](artifacts/phase1/daily-operations-offline.png)

Observed dashboard state:

- authenticated as `superadmin`
- dashboard rendered successfully
- cards loaded from current Zustand-backed runtime state

## Smoke Test Note

The screenshot automation produced the required dashboard evidence, but the later part of the same smoke run hit HTTP `429 Too Many Requests` responses. This is consistent with the configured Phase 0 limiter of `100 requests / 15 minutes`, not a startup failure.

Artifacts captured during the run:

- [artifacts/phase1/login-debug.png](artifacts/phase1/login-debug.png)
- [artifacts/phase1/login-debug.html](artifacts/phase1/login-debug.html)
- [artifacts/phase1/login-debug.txt](artifacts/phase1/login-debug.txt)

## Conclusion

Phase 1 is operational with PostgreSQL-backed runtime under Docker and a server-first Zustand inventory store.

Key outcome:

- inventory state bootstrap and synchronization now depend on server APIs through Zustand instead of local fallback hydration.# PHASE 1 POSTGRESQL PIVOT AND ZUSTAND REPORT - 2026-03-13

## Status

- Phase: `1`
- Result: `COMPLETED`
- Scope: PostgreSQL confirmation, Zustand single source of truth for inventory domains, full build validation, runtime proof, and authenticated browser screenshots.

## Mandatory Execution Order Completed

1. Verified `backend/prisma/schema.prisma` is configured for PostgreSQL and added the Phase 1 header.
2. Verified `docker-compose.yml` contains the required PostgreSQL service, backend `DATABASE_URL`, and frontend port `4173`, then added the Phase 1 header.
3. Cleaned `frontend/src/App.tsx` so inventory `transactions` and `users` now come from Zustand instead of storage bootstrap/persist paths.
4. Refactored `frontend/src/store/useInventoryStore.ts` to remove `persist`, local fallback helpers, and localStorage-backed bootstrap behavior.
5. Ran `npm run build:full` successfully.
6. Rebuilt and started the Docker stack, then validated backend health and authenticated browser access.
7. Captured fresh authenticated screenshots for Dashboard, Reports, and Daily Operations.

## Files Updated

- `backend/prisma/schema.prisma`
- `docker-compose.yml`
- `frontend/src/App.tsx`
- `frontend/src/store/useInventoryStore.ts`

## PostgreSQL Confirmation

Validated in source:

- Prisma datasource uses `provider = "postgresql"`.
- Prisma datasource uses `url = env("DATABASE_URL")`.
- Docker Compose includes PostgreSQL database `feed_factory_db`.
- Backend Compose environment uses `postgresql://feedfactory:SecurePassword2026!@postgres:5432/feed_factory_db`.
- Frontend is exposed on port `4173`.

## Zustand Single Source Of Truth Confirmation

Inventory domains now owned by Zustand:

- `items`
- `transactions`
- `openingBalances`
- `users`

Confirmed outcomes:

- `frontend/src/App.tsx` no longer references `getTransactions`, `saveTransactions`, `getUsers`, `saveUsers`, `InventoryContext`, or direct `localStorage` access.
- `frontend/src/store/useInventoryStore.ts` no longer uses `persist(...)`, `read(...)`, `write(...)`, `getOpeningBalancesByYear(...)`, or `upsertOpeningBalances(...)`.
- `loadAll()` now hydrates the store by calling server-backed sync.
- `syncFromServer()` now supports targeted server refresh for `items`, `transactions`, `openingBalances`, and `users` without JSON/local fallback.
- Wildcard route is now protected with `ProtectedRoute`.
- `clearAllAuthData()` is invoked explicitly in the login success path.

## Full Build Result

Command:

```powershell
npm run build:full
```

Result:

- Frontend TypeScript build passed.
- Frontend Vite production build passed.
- Backend TypeScript build passed.

## Docker Runtime Proof

Compose sequence used:

```powershell
docker compose down
docker builder prune -af
docker compose build backend
docker compose up -d
docker compose up -d --build
```

Notes:

- The first direct `docker compose up -d --build` attempt hit a transient Docker BuildKit snapshot/cache failure during image export.
- After `docker builder prune -af`, both images built cleanly.
- Final `docker compose up -d --build` completed successfully with all services started.

## docker compose up --build - First 100 Lines

```text
time="2026-03-25T11:33:46+02:00" level=warning msg="C:\Users\ireac\Documents\GitHub\MZ.S-ERP\docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion"
 Image mzs-erp-frontend Building 
 Image mzs-erp-backend Building 
#1 [internal] load local bake definitions
#1 reading from stdin 1.05kB done
#1 DONE 0.0s

#2 [frontend internal] load build definition from Dockerfile
#2 transferring dockerfile: 572B 0.0s done
#2 DONE 0.1s

#3 [backend internal] load build definition from Dockerfile
#3 transferring dockerfile: 747B 0.0s done
#3 DONE 0.1s

#4 [backend internal] load metadata for docker.io/library/node:20-bookworm-slim
#4 ...

#5 [frontend internal] load metadata for docker.io/library/node:20-alpine
#5 DONE 0.5s

#6 [frontend internal] load metadata for docker.io/library/nginx:alpine
#6 ...

#4 [backend internal] load metadata for docker.io/library/node:20-bookworm-slim
#4 DONE 0.8s

#7 [backend internal] load .dockerignore
#7 transferring context: 189B done
#7 DONE 0.0s

#8 [backend  1/12] FROM docker.io/library/node:20-bookworm-slim@sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd
#8 resolve docker.io/library/node:20-bookworm-slim@sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd 0.0s done
#8 DONE 0.0s

#9 [backend internal] load build context
#9 transferring context: 7.31kB 0.1s done
#9 DONE 0.1s

#10 [backend  8/12] COPY tsconfig.run.json ./
#10 CACHED

#11 [backend  9/12] COPY src ./src
#11 CACHED

#12 [backend 11/12] RUN npx prisma generate
#12 CACHED

#13 [backend  2/12] WORKDIR /app
#13 CACHED

#14 [backend  3/12] RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
#14 CACHED

#15 [backend  6/12] COPY nest-cli.json ./
#15 CACHED

#16 [backend  4/12] COPY package*.json ./
#16 CACHED

#17 [backend  5/12] COPY prisma ./prisma
#17 CACHED

#18 [backend  7/12] COPY tsconfig.json ./
#18 CACHED

#19 [backend 10/12] RUN npm ci
#19 CACHED

#20 [backend 12/12] RUN npm run build
#20 CACHED

#21 [backend] exporting to image
#21 exporting layers 0.0s done
#21 exporting manifest sha256:df47c011e38c4f4a89347da0942612e5729257731c4b93e9583b1dd16ead9fd4 done
#21 exporting config sha256:bba4ef637b4e17ce510ba85c7252a8c4b105dfe99aec74c703666971aba32156 done
#21 exporting attestation manifest sha256:640efeaecb47c5d8b305887966fa59e9ea5b05355d7d9c69c41621a3bbaf51e5 0.0s done
#21 exporting manifest list sha256:c442b962dc233a84bed218684f87cd9f097a46017585f4243e100d8089dd5ab1 0.0s done
#21 naming to docker.io/library/mzs-erp-backend:latest
#21 ...

#6 [frontend internal] load metadata for docker.io/library/nginx:alpine
#6 DONE 1.2s

#22 [frontend internal] load .dockerignore
#22 transferring context: 153B done
#22 DONE 0.0s

#23 [frontend internal] load build context
#23 DONE 0.0s

#21 [backend] exporting to image
#21 naming to docker.io/library/mzs-erp-backend:latest done
#21 unpacking to docker.io/library/mzs-erp-backend:latest 0.0s done
#21 DONE 0.3s

#24 [frontend builder 1/6] FROM docker.io/library/node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa
#24 resolve docker.io/library/node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa 0.1s done
#24 DONE 0.1s
```

## docker compose up --build - Last 50 Lines

```text
#23 DONE 0.4s

#26 [backend] resolving provenance for metadata file
#26 DONE 0.0s

#27 [frontend stage-1 2/3] COPY nginx.frontend.conf /etc/nginx/conf.d/default.conf
#27 CACHED

#28 [frontend builder 3/6] COPY package*.json ./
#28 CACHED

#29 [frontend builder 2/6] WORKDIR /app
#29 CACHED

#30 [frontend builder 4/6] RUN npm ci
#30 CACHED

#31 [frontend builder 5/6] COPY . .
#31 CACHED

#32 [frontend builder 6/6] RUN npm run build
#32 CACHED

#33 [frontend stage-1 3/3] COPY --from=builder /app/dist /usr/share/nginx/html
#33 CACHED

#34 [frontend] exporting to image
#34 exporting layers 0.0s done
#34 exporting manifest sha256:e59c41e30f606ab612f010de5f130d427f86622022ff6aa26743f2edb15af5ac done
#34 exporting config sha256:7c427714c7f576fcfa0d90912269f1b0d5553a4584729b2e11ab41b4379a6bce done
#34 exporting attestation manifest sha256:cf8af0f7ddaf35228c4e6b8bfb3c33cb86b4740abf1910adf19410150bfc8fa9 0.0s done
#34 exporting manifest list sha256:105d05ea13a603a436a8398c91b51e853bd688506a616074da80502862b1697b 0.1s done
#34 naming to docker.io/library/mzs-erp-frontend:latest
#34 naming to docker.io/library/mzs-erp-frontend:latest done
#34 unpacking to docker.io/library/mzs-erp-frontend:latest 0.0s done
#34 DONE 0.3s

#35 [frontend] resolving provenance for metadata file
#35 DONE 0.2s
 Image mzs-erp-backend Built 
 Image mzs-erp-frontend Built 
 Container mzs-erp-postgres-1 Running 
 Container mzs-erp-backend-1 Recreate 
 Container mzs-erp-backend-1 Recreated 
 Container mzs-erp-frontend-1 Recreate 
 Container mzs-erp-frontend-1 Recreated 
 Container mzs-erp-backend-1 Starting 
 Container mzs-erp-backend-1 Started 
 Container mzs-erp-frontend-1 Starting 
 Container mzs-erp-frontend-1 Started 
```

## Runtime Verification

Compose status after startup:

- `postgres` up on `5432`
- `backend` up on `3001`
- `frontend` up on `4173`

Backend health verification:

```powershell
$env:HEALTH_URL='http://localhost:3001/api/health'
npm run health-check
```

Result:

```json
{"ok":true,"url":"http://localhost:3001/api/health","status":"healthy","uptime":80.85,"dbConnected":true}
```

## Fresh Authenticated Browser Proof

Command:

```powershell
$env:FRONTEND_URL='http://localhost:4173'
$env:SCREENSHOT_DIR='C:\Users\ireac\Documents\GitHub\MZ.S-ERP\artifacts\phase1'
node backend/scripts/smoke-frontend.mjs
```

Outcome:

- Login user: `superadmin`
- Role: `SuperAdmin`
- Dashboard loaded successfully.
- Reports loaded successfully.
- Daily Operations loaded successfully.
- Offline banner proof succeeded.

Artifacts:

- `artifacts/phase1/dashboard.png`
- `artifacts/phase1/reports.png`
- `artifacts/phase1/daily-operations.png`
- `artifacts/phase1/daily-operations-offline.png`
- `artifacts/phase1/compose-up-build.txt`
- `artifacts/phase1/compose-logs.txt`

## Screenshot Notes

- Dashboard screenshot confirms authenticated `System SuperAdmin` state after login.
- Reports screenshot confirms protected route access after the Zustand/server sync refactor.
- Daily Operations screenshot confirms the inventory routes stay functional after removing localStorage fallback from the inventory store.

## Observations

- A transient unauthenticated `401 GET /api/auth/me` appears before scripted login during browser smoke. This is expected during the pre-auth page load and does not block login.
- `docker-compose.yml` still triggers a harmless Compose warning about the legacy `version` key being obsolete.
- The repository health-check script defaults to `http://localhost/api/health`; for this stack the correct live probe is `http://localhost:3001/api/health`.

## Final Assessment

- PostgreSQL is the active backend datastore in Prisma and Compose.
- Zustand is now the single source of truth for the targeted inventory domains in Phase 1.
- The monorepo builds successfully.
- Docker runtime proof succeeded.
- Authenticated browser proof and screenshots succeeded.

## Declaration

Phase 1 is complete.