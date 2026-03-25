# PHASE 1 POSTGRESQL PIVOT AND ZUSTAND REPORT - 2026-03-13

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