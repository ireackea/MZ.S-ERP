# MZ.S-ERP Operations Notes

## Runtime Stop Rules

- Use `START_MZS_ERP_OFFICIAL.bat /stop` or `START_MZS_ERP_OFFICIAL.bat /clean` for the official Docker runtime.
- Use `stop-mzs-erp-safe.ps1` for the local Node/Vite launcher runtime.
- `stop-mzs-erp-safe.ps1` intentionally skips Docker Desktop and WSL runtime processes. Docker Desktop owns host port proxies for published container ports, and killing those PIDs can break the Docker API instead of stopping this application.

## Startup Health

- The official launcher verifies PostgreSQL, backend health, frontend, frontend API proxy, and metrics before declaring readiness.
- Docker container healthchecks can lag behind HTTP readiness because they run on an interval. The official launcher waits for that healthcheck convergence before failing startup.

## Local Launcher Tooling

- The local launcher requires `node`, `npm`, and `git` in `PATH`.
- The official Docker launcher does not require host Node.js because Node runs inside the backend/frontend images.