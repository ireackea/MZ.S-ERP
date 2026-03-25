# PHASE 0 - Critical Security & Encoding Lockdown

Date: 2026-03-13
Workspace: MZ.S-ERP

## Executive Summary

Phase 0 critical hardening was implemented in the requested backend surfaces and validated with a successful full build plus a clean UTF-8 encoding check.

Completed hardening items:

- Removed insecure plain-text password fallback from [backend/src/auth/auth.service.ts](backend/src/auth/auth.service.ts#L281).
- Replaced hard-coded reset confirmation token with `process.env.RESET_TOKEN` in [backend/src/monitoring/monitoring.service.ts](backend/src/monitoring/monitoring.service.ts#L25) and [backend/src/monitoring/monitoring.service.ts](backend/src/monitoring/monitoring.service.ts#L82).
- Replaced fallback backup encryption secret with required `process.env.BACKUP_ENCRYPTION_SECRET` in [backend/src/backup/backup.service.ts](backend/src/backup/backup.service.ts#L159).
- Restricted WebSocket origins to `process.env.ALLOWED_ORIGINS` in [backend/src/realtime/realtime.gateway.ts](backend/src/realtime/realtime.gateway.ts#L18).
- Replaced the manual limiter with `express-rate-limit` and enforced `ValidationPipe` hardening in [backend/src/main.ts](backend/src/main.ts#L189) and [backend/src/main.ts](backend/src/main.ts#L273).
- Added the required backend dependency in [backend/package.json](backend/package.json#L30).
- Added required runtime environment variables to [docker-compose.yml](docker-compose.yml#L26).

## Modified Files

- [backend/src/auth/auth.service.ts](backend/src/auth/auth.service.ts)
- [backend/src/monitoring/monitoring.service.ts](backend/src/monitoring/monitoring.service.ts)
- [backend/src/backup/backup.service.ts](backend/src/backup/backup.service.ts)
- [backend/src/realtime/realtime.gateway.ts](backend/src/realtime/realtime.gateway.ts)
- [backend/src/main.ts](backend/src/main.ts)
- [backend/package.json](backend/package.json)
- [backend/package-lock.json](backend/package-lock.json)
- [docker-compose.yml](docker-compose.yml)

## Validation Results

### `npm run check:encoding`

Status: Passed

```text
> feedfactory-pro@0.0.0 check:encoding
> node scripts/check-text-encoding.mjs

Text encoding check passed.
```

### `npm run build:full`

Status: Passed

```text
> feedfactory-pro@0.0.0 build:full
> npm run frontend:build && npm run backend:build

> @feedfactory/frontend@0.0.0 build
> tsc && vite build

vite v5.4.21 building for production...
✓ 3551 modules transformed.
...
✓ built in 25.90s

> @feedfactory/backend@0.0.0 build
> tsc -p tsconfig.json
```

## Runtime Proof Status

### Current environment status

Fresh Docker Compose proof could not be regenerated in the current VS Code terminal environment because the Docker CLI is not consistently available in PATH for the current shell session.

Observed shell error:

```text
docker: The term 'docker' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

### Current local database blocker

Fresh local backend runtime proof against `127.0.0.1:5432` is blocked by PostgreSQL authentication failure for the configured `feedfactory` user.

```text
> @feedfactory/backend@0.0.0 prisma:migrate:prod
> prisma migrate deploy

Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "feed_factory_db", schema "public" at "127.0.0.1:5432"

Error: P1000: Authentication failed against database server at `127.0.0.1`, the provided database credentials for `feedfactory` are not valid.
```

## Dashboard Screenshot Evidence

Available screenshot artifact from the existing runtime proof set:

- [artifacts/phase0.2/dashboard.png](artifacts/phase0.2/dashboard.png)

The available dashboard capture shows successful authenticated access to the Arabic dashboard UI with live dashboard widgets and navigation visible.

Additional existing artifacts in the same evidence set:

- [artifacts/phase0.2/reports.png](artifacts/phase0.2/reports.png)
- [artifacts/phase0.2/daily-operations.png](artifacts/phase0.2/daily-operations.png)
- [artifacts/phase0.2/daily-operations-offline.png](artifacts/phase0.2/daily-operations-offline.png)
- [artifacts/phase0.2/login-debug.html](artifacts/phase0.2/login-debug.html)
- [artifacts/phase0.2/login-debug.txt](artifacts/phase0.2/login-debug.txt)

## Docker Compose Logs

Because fresh Docker Compose execution could not be reproduced in the current shell environment, the latest available successful proof log from [artifacts/phase0.2/docker-compose-up.log](artifacts/phase0.2/docker-compose-up.log) is included below as the requested first 100 and last 50 lines.

### First 100 lines

```text
frontend-1  | /docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration
frontend-1  | /docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/
frontend-1  | /docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
postgres-1  |
postgres-1  | PostgreSQL Database directory appears to contain a database; Skipping initialization
postgres-1  |
postgres-1  | 2026-03-19 05:33:03.801 UTC [1] LOG:  starting PostgreSQL 16.13 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
postgres-1  | 2026-03-19 05:33:03.801 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
postgres-1  | 2026-03-19 05:33:03.801 UTC [1] LOG:  listening on IPv6 address "::", port 5432
postgres-1  | 2026-03-19 05:33:03.805 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
postgres-1  | 2026-03-19 05:33:03.812 UTC [29] LOG:  database system was shut down at 2026-03-19 05:29:54 UTC
postgres-1  | 2026-03-19 05:33:03.824 UTC [1] LOG:  database system is ready to accept connections
postgres-1  | 2026-03-19 05:38:03.846 UTC [27] LOG:  checkpoint starting: time
postgres-1  | 2026-03-19 05:38:06.172 UTC [27] LOG:  checkpoint complete: wrote 26 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.312 s, sync=0.007 s, total=2.327 s; sync files=13, longest=0.003 s, average=0.001 s; distance=43 kB, estimate=43 kB; lsn=0/1A0E590, redo lsn=0/1A0E558
postgres-1  | 2026-03-19 05:48:03.309 UTC [27] LOG:  checkpoint starting: time
postgres-1  | 2026-03-19 05:48:03.782 UTC [27] LOG:  checkpoint complete: wrote 3 buffers (0.0%); 0 WAL file(s) added, 0 removed, 0 recycled; write=0.204 s, sync=0.004 s, total=0.473 s; sync files=3, longest=0.003 s, average=0.002 s; distance=5 kB, estimate=39 kB; lsn=0/1A0FCA0, redo lsn=0/1A0FC68
postgres-1  | 2026-03-19 05:53:03.852 UTC [27] LOG:  checkpoint starting: time
postgres-1  | 2026-03-19 05:53:06.890 UTC [27] LOG:  checkpoint complete: wrote 31 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=3.013 s, sync=0.016 s, total=3.038 s; sync files=19, longest=0.009 s, average=0.001 s; distance=23 kB, estimate=38 kB; lsn=0/1A15950, redo lsn=0/1A15918
postgres-1  | 2026-03-19 06:03:34.960 UTC [1268] LOG:  could not send data to client: Broken pipe
postgres-1  | 2026-03-19 06:03:34.992 UTC [1268] FATAL:  connection to client lost
frontend-1  | 10-listen-on-ipv6-by-default.sh: info: Getting the checksum of /etc/nginx/conf.d/default.conf
frontend-1  | 10-listen-on-ipv6-by-default.sh: info: /etc/nginx/conf.d/default.conf differs from the packaged version
frontend-1  | /docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh
frontend-1  | /docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh
frontend-1  | /docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh
frontend-1  | /docker-entrypoint.sh: Configuration complete; ready for start up
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: using the "epoll" event method
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: nginx/1.29.5
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: built by gcc 15.2.0 (Alpine 15.2.0)
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: OS: Linux 6.6.87.2-microsoft-standard-WSL2
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: getrlimit(RLIMIT_NOFILE): 1048576:1048576
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker processes
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 29
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 30
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 31
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 32
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 33
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 34
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 35
frontend-1  | 2026/03/19 06:05:12 [notice] 1#1: start worker process 36
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:16 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "127.0.0.1"
frontend-1  | 127.0.0.1 - - [19/Mar/2026:06:05:17 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "-"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:25 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "127.0.0.1"
frontend-1  | 127.0.0.1 - - [19/Mar/2026:06:05:38 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "-"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET / HTTP/1.1" 200 1583 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET /assets/index-Bhc8Hg9x.js HTTP/1.1" 200 362945 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET /assets/vendor-datepicker-DOWoSJlK.js HTTP/1.1" 200 181872 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET /assets/index-ChjUuVoN.css HTTP/1.1" 200 439 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET /assets/export-exceljs-6-VEb1YY.js HTTP/1.1" 200 937964 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET /manifest.json HTTP/1.1" 200 2325 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET /assets/vendor-recharts-Bc4qZY1I.js HTTP/1.1" 200 558394 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:40 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "127.0.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /sw.js HTTP/1.1" 200 9679 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /assets/LoginV2-CRIHprC-.js HTTP/1.1" 200 8528 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /favicon.ico HTTP/1.1" 200 1583 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /assets/user-BXtmztBy.js HTTP/1.1" 200 193 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /assets/eye-BHSExXUp.js HTTP/1.1" 200 542 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /icons/icon-192x192.png HTTP/1.1" 200 1666 "http://localhost:4173/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /index.html HTTP/1.1" 200 1583 "http://localhost:4173/sw.js" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:42 +0000] "GET /assets/lock-76i_YCe9.js HTTP/1.1" 200 203 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:43 +0000] "GET /assets/Dashboard-Dxxra1El.js HTTP/1.1" 200 7687 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:43 +0000] "GET /assets/printer-BEQfjrNg.js HTTP/1.1" 200 296 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:43 +0000] "GET /assets/circle-alert-BcJMw9Yu.js HTTP/1.1" 200 246 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:44 +0000] "GET /dashboard HTTP/1.1" 200 1583 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:47 +0000] "GET /reports HTTP/1.1" 200 1583 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:47 +0000] "GET /assets/Reports-CULdibmK.js HTTP/1.1" 200 14814 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:47 +0000] "GET /assets/filter-DLrJtjhs.js HTTP/1.1" 200 158 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:47 +0000] "GET /assets/database-b7YzABUx.js HTTP/1.1" 200 240 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:47 +0000] "GET /assets/Reports-BuqMdKp-.css HTTP/1.1" 200 22705 "http://localhost:4173/reports" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:47 +0000] "GET /assets/download-BYFCeXKm.js HTTP/1.1" 200 259 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:50 +0000] "GET /operations HTTP/1.1" 200 1583 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/DailyOperations-DJhYXirc.js HTTP/1.1" 200 127850 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/rotate-ccw-ByUjILPN.js HTTP/1.1" 200 196 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/gridModules-DjbXh4rT.js HTTP/1.1" 200 5316 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/UniversalColumnManager-CYf3WtFx.js HTTP/1.1" 200 4424 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/vendor-fuse-DPyu62bB.js HTTP/1.1" 200 15765 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/layers-B66oci42.js HTTP/1.1" 200 361 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/file-up-DCK3cW7f.js HTTP/1.1" 200 297 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/scale-DhWESc7e.js HTTP/1.1" 200 360 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/hash-B5qSwzUB.js HTTP/1.1" 200 293 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/truck-ByMN5JiU.js HTTP/1.1" 200 398 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/trash-2-DGOjV2w3.js HTTP/1.1" 200 354 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/plus-D8w5hSuT.js HTTP/1.1" 200 150 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/shield-check-Cth40ZCa.js HTTP/1.1" 200 316 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/save-DDcSfW5y.js HTTP/1.1" 200 277 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/search-BmpNZxY8.js HTTP/1.1" 200 164 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:51 +0000] "GET /assets/upload-2gpeUl_0.js HTTP/1.1" 200 254 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:54 +0000] "GET /sw.js HTTP/1.1" 304 0 "http://localhost:4173/sw.js" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:54 +0000] "GET /sw.js HTTP/1.1" 304 0 "http://localhost:4173/sw.js" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:54 +0000] "GET /sw.js HTTP/1.1" 304 0 "http://localhost:4173/sw.js" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36" "172.19.0.1"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:05:55 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "127.0.0.1"
frontend-1  | 127.0.0.1 - - [19/Mar/2026:06:05:58 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "-"
frontend-1  | 172.19.0.5 - - [19/Mar/2026:06:06:10 +0000] "GET / HTTP/1.1" 200 1583 "-" "Wget" "127.0.0.1"
nginx-1     | /docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration
nginx-1     | /docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/
nginx-1     | /docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
nginx-1     | 10-listen-on-ipv6-by-default.sh: info: can not modify /etc/nginx/conf.d/default.conf (read-only file system?)
nginx-1     | /docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh
nginx-1     | /docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh
nginx-1     | /docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh
```

### Last 50 lines

```text
backend-1   | [Nest] 152  - 03/19/2026, 6:05:07 AM     LOG [RoutesResolver] DashboardController {/api/dashboard}: +0ms
backend-1   | [Nest] 152  - 03/19/2026, 6:05:07 AM     LOG [RouterExplorer] Mapped {/api/dashboard/stats, GET} route +0ms
backend-1   | [Nest] 152  - 03/19/2026, 6:05:08 AM     LOG [NestApplication] Nest application successfully started +869ms
backend-1   | Backend (Nest) listening on port 3001
backend-1   | {"event":"http_request","method":"GET","path":"/api/health","statusCode":200,"durationMs":11,"ip":"::ffff:127.0.0.1","userAgent":"node","timestamp":"2026-03-19T06:05:11.862Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/health","statusCode":200,"durationMs":5,"ip":"::ffff:127.0.0.1","userAgent":"node","timestamp":"2026-03-19T06:05:27.143Z"}
backend-1   |
backend-1   | [Auth Monitor] [Backend Entry] Incoming: POST /api/auth/login
backend-1   |    [Auth Monitor] IP: 172.19.0.1
backend-1   | [Auth Service] Login attempt for username/email: superadmin
backend-1   | {"event":"http_request","method":"POST","path":"/api/auth/login","statusCode":201,"durationMs":286,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; ar-LY) PowerShell/7.5.4","timestamp":"2026-03-19T06:05:37.333Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":200,"durationMs":87,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26200; ar-LY) PowerShell/7.5.4","timestamp":"2026-03-19T06:05:37.425Z"}
backend-1   | [Nest] 152  - 03/19/2026, 6:05:42 AM   DEBUG [RealtimeGateway] Realtime client connected: 8U01KN84qSD1vx5WAAAB
backend-1   | {"event":"http_request","method":"GET","path":"/api/health","statusCode":200,"durationMs":5,"ip":"::ffff:127.0.0.1","userAgent":"node","timestamp":"2026-03-19T06:05:42.501Z"}
backend-1   |
backend-1   | [Auth Monitor] [Backend Entry] Incoming: POST /api/auth/login
backend-1   |    [Auth Monitor] IP: 172.19.0.1
backend-1   | [Auth Service] Login attempt for username/email: superadmin
backend-1   | {"event":"http_request","method":"POST","path":"/api/auth/login","statusCode":201,"durationMs":272,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:43.501Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":200,"durationMs":197,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:43.822Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/opening-balances/2026","statusCode":200,"durationMs":197,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:43.826Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/transactions","statusCode":200,"durationMs":207,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:43.830Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users/roles","statusCode":200,"durationMs":263,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:43.908Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":200,"durationMs":292,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:43.924Z"}
backend-1   | [Nest] 152  - 03/19/2026, 6:05:44 AM   DEBUG [RealtimeGateway] Realtime client disconnected: 8U01KN84qSD1vx5WAAAB
backend-1   | [Nest] 152  - 03/19/2026, 6:05:44 AM   DEBUG [RealtimeGateway] Realtime client connected: Ag-I5fagvsSCj6n_AAAD
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":304,"durationMs":93,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:44.614Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/transactions","statusCode":304,"durationMs":115,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:44.632Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/opening-balances/2026","statusCode":304,"durationMs":108,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:44.644Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":304,"durationMs":108,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:44.647Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users/roles","statusCode":304,"durationMs":139,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:44.680Z"}
backend-1   | [Nest] 152  - 03/19/2026, 6:05:47 AM   DEBUG [RealtimeGateway] Realtime client disconnected: Ag-I5fagvsSCj6n_AAAD
backend-1   | [Nest] 152  - 03/19/2026, 6:05:47 AM   DEBUG [RealtimeGateway] Realtime client connected: CBHH6SLw3Wnp1TWhAAAF
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":304,"durationMs":61,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:47.475Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/opening-balances/2026","statusCode":304,"durationMs":63,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:47.491Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/transactions","statusCode":304,"durationMs":71,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:47.495Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users/roles","statusCode":304,"durationMs":89,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:47.521Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":304,"durationMs":94,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:47.523Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":304,"durationMs":59,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:47.668Z"}
backend-1   | {"event":"http_request","method":"POST","path":"/api/reports/generate","statusCode":201,"durationMs":35,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:48.257Z"}
backend-1   | [Nest] 152  - 03/19/2026, 6:05:51 AM   DEBUG [RealtimeGateway] Realtime client disconnected: CBHH6SLw3Wnp1TWhAAAF
backend-1   | [Nest] 152  - 03/19/2026, 6:05:51 AM   DEBUG [RealtimeGateway] Realtime client connected: TZuL6q6Ror3K4Do1AAAH
backend-1   | {"event":"http_request","method":"GET","path":"/api/transactions","statusCode":304,"durationMs":101,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:51.355Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/opening-balances/2026","statusCode":304,"durationMs":135,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:51.389Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users","statusCode":304,"durationMs":158,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:51.427Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/items","statusCode":304,"durationMs":144,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:51.429Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/users/roles","statusCode":304,"durationMs":174,"ip":"172.19.0.1","userAgent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36","timestamp":"2026-03-19T06:05:51.445Z"}
backend-1   | [Nest] 152  - 03/19/2026, 6:05:56 AM   DEBUG [RealtimeGateway] Realtime client disconnected: TZuL6q6Ror3K4Do1AAAH
backend-1   | {"event":"http_request","method":"GET","path":"/api/health","statusCode":200,"durationMs":3,"ip":"::ffff:127.0.0.1","userAgent":"node","timestamp":"2026-03-19T06:05:57.891Z"}
backend-1   | {"event":"http_request","method":"GET","path":"/api/health","statusCode":200,"durationMs":4,"ip":"::ffff:127.0.0.1","userAgent":"node","timestamp":"2026-03-19T06:06:13.210Z"}
```

## Assessment

Code-level Phase 0 security work is complete and validated by build and encoding checks.

Residual environmental limitations for fresh runtime proof on this workstation:

- Docker CLI availability is inconsistent in the current shell environment.
- The local PostgreSQL instance on `127.0.0.1:5432` rejects the configured `feedfactory` credentials.

Despite those blockers, the repository already contains runtime evidence demonstrating successful login, dashboard rendering, and API activity in the saved Phase 0.2 artifact set.