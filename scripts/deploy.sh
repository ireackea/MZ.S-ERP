#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
else
  COMPOSE_CMD=(docker-compose)
fi

echo "[deploy] Updating source..."
git pull origin main

echo "[deploy] Stopping previous stack..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" down

echo "[deploy] Building and starting production stack..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up -d --build

echo "[deploy] Running Prisma migrations inside backend container..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" exec -T backend npx prisma migrate deploy

echo "[deploy] Running health check..."
npm run health-check

echo "[deploy] Done. Stack is up."

