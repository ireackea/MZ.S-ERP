# PHASE 2 SETTINGS AND CONSISTENCY REPORT

Date: 2026-03-25
Phase Label: ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13

## Scope Completed

This phase delivered the requested global consistency and settings restructuring for the frontend application.

Completed items:

- Created the modular settings section under `frontend/src/modules/settings/`
- Added per-tab RBAC guards for the Settings tabs
- Routed the application to use page-layer screens under `frontend/src/pages/` for the required domains
- Removed remaining targeted local fallback behavior from the requested pages
- Replaced `Stocktaking` print persistence from `localStorage` with Zustand-backed state
- Consolidated required global configuration slices inside `useInventoryStore`

## Settings Module Files

Created files:

- `frontend/src/modules/settings/pages/Settings.tsx`
- `frontend/src/modules/settings/components/GeneralSettings.tsx`
- `frontend/src/modules/settings/components/UsersAndRoles.tsx`
- `frontend/src/modules/settings/components/PermissionsMatrix.tsx`
- `frontend/src/modules/settings/components/BackupAndRestore.tsx`
- `frontend/src/modules/settings/components/SystemReset.tsx`
- `frontend/src/modules/settings/components/AuditLogs.tsx`
- `frontend/src/modules/settings/components/OfflineSettings.tsx`
- `frontend/src/modules/settings/components/PrintingTemplates.tsx`
- `frontend/src/modules/settings/components/ThemeAndLocalization.tsx`

## Zustand Consistency Confirmation

The following requested pages now render from Zustand-backed data paths only for their target domains:

- `frontend/src/pages/Items.tsx`
- `frontend/src/pages/Operations.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/Reports.tsx`
- `frontend/src/pages/Formulation.tsx`
- `frontend/src/pages/Stocktaking.tsx`
- `frontend/src/pages/OpeningBalancePage.tsx`

Additional consistency work completed:

- `frontend/src/App.tsx` now routes the requested domains through the `pages/` layer
- `frontend/src/store/useInventoryStore.ts` now carries:
  - `systemSettings`
  - `unloadingRules`
  - `reportConfig`
  - `openingBalanceReportConfig`
  - `formulas`
  - `stocktakingPrintConfig`
  - `stocktakingPrintTemplates`

## RBAC Coverage

Settings tab permission IDs added and wired:

- `settings.view.general`
- `settings.view.users`
- `settings.view.permissions`
- `settings.view.backup`
- `settings.view.reset`
- `settings.view.audit`
- `settings.view.offline`
- `settings.view.printing`
- `settings.view.localization`

Notes:

- Standard access still flows through `usePermissions`
- Privileged admin/superadmin sessions are also honored from the top-level `currentUser` passed by `App.tsx`, which resolved the runtime mismatch between restored server session state and the local hook state for Settings access

## Build Proof

Command executed:

```bash
npm run build:full
```

Result:

- Frontend build passed with Vite production output generated
- Backend TypeScript build passed
- No TypeScript errors remained after the final Phase 2 changes

## Runtime Proof

Compose command executed:

```bash
docker-compose up --build
```

Captured full log:

- `artifacts/phase2/docker-compose-up-phase2.log`

Health validation executed:

```bash
npm run health-check
```

Health result:

```json
{"ok":true,"url":"http://localhost:3001/api/health","status":"healthy","uptime":34.98,"dbConnected":true}
```

Authentication smoke validation executed:

```bash
npm run test:e2e:login
```

Result:

- `tests/e2e/login.spec.ts` passed
- backend login succeeded
- metrics endpoint validation succeeded

## Settings Screenshots

Captured screenshots for all Settings tabs:

- `artifacts/phase2/settings-screenshots/general.png`
- `artifacts/phase2/settings-screenshots/users.png`
- `artifacts/phase2/settings-screenshots/permissions.png`
- `artifacts/phase2/settings-screenshots/backup.png`
- `artifacts/phase2/settings-screenshots/reset.png`
- `artifacts/phase2/settings-screenshots/audit.png`
- `artifacts/phase2/settings-screenshots/offline.png`
- `artifacts/phase2/settings-screenshots/printing.png`
- `artifacts/phase2/settings-screenshots/theme.png`

## docker-compose up --build Logs

### First 50 Lines

```text
time="2026-03-25T15:53:33+02:00" level=warning msg="C:\Users\ireac\Documents\GitHub\MZ.S-ERP\docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion"
 Image mzs-erp-frontend Building 
 Image mzs-erp-backend Building 
#1 [internal] load local bake definitions
#1 reading from stdin 1.05kB done
#1 DONE 0.0s

#2 [backend internal] load build definition from Dockerfile
#2 transferring dockerfile: 747B 0.0s done
#2 DONE 0.0s

#3 [frontend internal] load build definition from Dockerfile
#3 transferring dockerfile: 572B 0.0s done
#3 DONE 0.1s

#4 [auth] library/nginx:pull token for registry-1.docker.io
#4 DONE 0.0s

#5 [auth] library/node:pull token for registry-1.docker.io
#5 DONE 0.0s

#6 [frontend internal] load metadata for docker.io/library/nginx:alpine
#6 ...

#7 [backend internal] load metadata for docker.io/library/node:20-bookworm-slim
#7 DONE 1.9s

#8 [backend internal] load .dockerignore
#8 transferring context: 189B 0.0s done
#8 DONE 0.0s

#6 [frontend internal] load metadata for docker.io/library/nginx:alpine
#6 DONE 1.9s

#9 [frontend internal] load metadata for docker.io/library/node:20-alpine
#9 DONE 1.9s

#10 [frontend internal] load .dockerignore
#10 transferring context: 153B done
#10 DONE 0.0s

#11 [frontend internal] load build context
#11 DONE 0.0s

#12 [frontend stage-1 1/3] FROM docker.io/library/nginx:alpine@sha256:e7257f1ef28ba17cf7c248cb8ccf6f0c6e0228ab9c315c152f9c203cd34cf6d1
#12 resolve docker.io/library/nginx:alpine@sha256:e7257f1ef28ba17cf7c248cb8ccf6f0c6e0228ab9c315c152f9c203cd34cf6d1 0.0s done
#12 DONE 0.1s

#13 [backend internal] load build context
#13 DONE 0.0s
```

### Last 50 Lines

```text
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/trash-2-YHAOl55z.js HTTP/1.1" 200 354 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/lock-Dh2AsncY.js HTTP/1.1" 200 203 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/BackupCenter-DSyPIFr4.js HTTP/1.1" 200 19895 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/index-C5CUprPP.js HTTP/1.1" 200 2997 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/clock-DZ-Dw8Ja.js HTTP/1.1" 200 175 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/download-DOi4svEH.js HTTP/1.1" 200 259 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/systemResetService-Csr7N_Ir.js HTTP/1.1" 200 1464 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/circle-check-CR4xC8lW.js HTTP/1.1" 200 169 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/user-DKYJtJZb.js HTTP/1.1" 200 193 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/layout-grid-CkmrFKSs.js HTTP/1.1" 200 342 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /assets/refresh-ccw-C8-Ua31H.js HTTP/1.1" 200 317 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:36 +0000] "GET /api/auth/me HTTP/1.1" 304 0 "http://127.0.0.1:4173/settings?phase2=1774447053274" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | {"event":"http_request","method":"GET","path":"/api/auth/me","statusCode":304,"durationMs":89,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:57:36.849Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users/roles","statusCode":304,"durationMs":29,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:57:38.669Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:38 +0000] "GET /api/users/roles HTTP/1.1" 304 0 "http://127.0.0.1:4173/settings?phase2=1774447053274" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:38 +0000] "GET /api/users?page=1&limit=20 HTTP/1.1" 200 3075 "http://127.0.0.1:4173/settings?phase2=1774447053274" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":200,"durationMs":33,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:57:38.674Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:38 +0000] "GET /api/users?page=1&limit=20 HTTP/1.1" 304 0 "http://127.0.0.1:4173/settings?phase2=1774447053274" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":304,"durationMs":27,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:57:38.705Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:38 +0000] "GET /api/users/08f00c1e-48ab-4d35-8ae1-a184787be7ce/audit HTTP/1.1" 200 2 "http://127.0.0.1:4173/settings?phase2=1774447053274" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | {"event":"http_request","method":"GET","path":"/api/users/08f00c1e-48ab-4d35-8ae1-a184787be7ce/audit","statusCode":200,"durationMs":79,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:57:38.895Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:57:40 +0000] "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1" 101 264 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | [Nest] 156  - 03/25/2026, 1:57:40 PM   DEBUG [RealtimeGateway] Realtime client disconnected: s3ns_uLQaUNm1O4xAAAH
backend-1   | 
backend-1   | [Auth Monitor] [Backend Entry] Incoming: POST /api/auth/login
backend-1   |    [Auth Monitor] IP: ::ffff:172.18.0.1
backend-1   | [Auth Service] Login attempt for username/email: superadmin
backend-1   | [Auth Service] ensureDefaultAdmin skipped due to runtime error: ADMIN_PASSWORD is required for superadmin bootstrap
backend-1   | {"event":"http_request","method":"POST","path":"/api/auth/login","statusCode":201,"durationMs":126,"ip":"::ffff:172.18.0.1","userAgent":"Playwright/1.58.2 (x64; windows 10.0) node/24.14","timestamp":"2026-03-25T13:58:00.551Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:01 +0000] "GET /settings?phase2=1774447081474 HTTP/1.1" 200 1583 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:01 +0000] "GET /assets/index-DLL7JRGf.js HTTP/1.1" 200 357294 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:01 +0000] "GET /assets/vendor-recharts-C3UCiGh7.js HTTP/1.1" 200 558394 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:01 +0000] "GET /assets/export-exceljs-CaJkFnL3.js HTTP/1.1" 200 937964 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:01 +0000] "GET /assets/index-ChjUuVoN.css HTTP/1.1" 200 439 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:01 +0000] "GET /assets/vendor-datepicker-D6zyaJjM.js HTTP/1.1" 200 181872 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:02 +0000] "GET /favicon.ico HTTP/1.1" 200 1583 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | 
backend-1   | [Auth Monitor] [Backend Entry] Incoming: GET /api/auth/me
backend-1   |    [Auth Monitor] IP: 172.18.0.1
backend-1   | {"event":"http_request","method":"GET","path":"/api/auth/me","statusCode":200,"durationMs":23,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:58:02.787Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:02 +0000] "GET /api/auth/me HTTP/1.1" 200 187 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | [Nest] 156  - 03/25/2026, 1:58:02 PM   DEBUG [RealtimeGateway] Realtime client connected: nraNaCTMfJu6jXFpAAAJ
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:02 +0000] "GET /api/items HTTP/1.1" 200 2 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":200,"durationMs":44,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:58:02.908Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/transactions","statusCode":200,"durationMs":45,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:58:02.910Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:02 +0000] "GET /api/transactions HTTP/1.1" 200 42 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:02 +0000] "GET /api/opening-balances/2026 HTTP/1.1" 200 2 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
backend-1   | {"event":"http_request","method":"GET","path":"/api/opening-balances/2026","statusCode":200,"durationMs":47,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:58:02.924Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":200,"durationMs":65,"ip":"172.18.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0","timestamp":"2026-03-25T13:58:02.938Z"}
frontend-1  | 172.18.0.1 - - [25/Mar/2026:13:58:02 +0000] "GET /api/users?page=1&limit=200 HTTP/1.1" 200 3076 "http://127.0.0.1:4173/settings?phase2=1774447081474" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0" "-"
```

## Conclusion

Phase 2 is implemented with:

- modular Settings architecture
- per-tab access boundaries
- page-layer routing consistency
- Zustand-backed targeted pages without the previous local fallback behavior
- successful build proof
- successful Docker runtime proof
- successful health and login smoke proof
- captured screenshots for all requested Settings tabs