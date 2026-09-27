# SECURITY FIX: 2026-03-28 - Added non-root user, minimized attack surface
# ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
# ENTERPRISE FIX: Phase 0 – التنظيف الأساسي والأمان الحرج - 2026-03-13

# Stage 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install only essential build dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY nest-cli.json ./
COPY tsconfig.json ./
COPY tsconfig.run.json ./
COPY src ./src

# FC-OPS-002 — the browser download is ~627MB pulled by puppeteer's own
# postinstall during `npm ci`, and the CDN that serves it fails intermittently. A
# transient outage was taking the whole build down with "All providers failed for
# chrome", which is a network problem reported as a build problem.
#
# PUPPETEER_SKIP_CHROME=true skips the download at its real source — the
# postinstall hook — rather than only the redundant explicit install below. It is
# for development and CI, where PDF output is not exercised. Leave it unset in
# production: POST /render-pdf, /reports/generate and /reports/print all need a
# browser, and without one they answer 503 with that reason rather than a 500
# carrying a puppeteer stack trace (see src/common/pdf-browser.ts).
#
#   docker build --build-arg PUPPETEER_SKIP_CHROME=true ...
ARG PUPPETEER_SKIP_CHROME=false
RUN if [ "$PUPPETEER_SKIP_CHROME" = "true" ]; then \
      echo "PUPPETEER_SKIP_CHROME=true - installing without a browser"; \
      PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci; \
      mkdir -p /root/.cache/puppeteer; \
    else \
      npm ci; \
      for attempt in 1 2 3; do \
        echo "puppeteer chrome install attempt ${attempt}"; \
        npx puppeteer browsers install chrome && break; \
        echo "attempt ${attempt} failed, backing off"; sleep $((attempt * 15)); \
        if [ "$attempt" = "3" ]; then \
          echo "ERROR: chrome is still unavailable after 3 attempts."; \
          echo "       Retry the build, or pass --build-arg PUPPETEER_SKIP_CHROME=true"; \
          echo "       and accept that the PDF endpoints will answer 503."; \
          exit 1; \
        fi; \
      done; \
    fi
RUN npm run prisma:generate
RUN npm run build

# Stage 2: Production
FROM node:20-bookworm-slim AS production

WORKDIR /app

# SECURITY FIX: 2026-03-28 - Install minimal runtime dependencies only
# FC-OPS-001: PostgreSQL client tools. These must match the server major version
# (postgres:16), because pg_dump refuses to run against a newer server. The
# Debian default is v15, so the PGDG apt repository is used to pin v16.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get install -y --no-install-recommends \
    # Minimal chromium dependencies for PDF generation (if needed)
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
  && rm -rf /var/lib/apt/lists/* \
  # Clean up apt cache
  && apt-get clean

# SECURITY FIX: 2026-03-28 - Create non-root user
RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

# Copy built application from builder
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/prisma.config.ts ./prisma.config.ts
# FC-OPS-002 — a COPY is the only thing that reaches across stages; the
# production stage starts from a bare node image and has no puppeteer cache of
# its own, so an in-stage `cp` would always fail. The builder creates the
# directory even when the browser is skipped, so this copy is unconditional and
# simply brings an empty directory in that case.
COPY --from=builder --chown=appuser:appgroup /root/.cache/puppeteer /home/appuser/.cache/puppeteer

# SECURITY FIX: 2026-03-28 - Create writable runtime directories for non-root startup
RUN mkdir -p /app/backups /app/uploads/items \
  && chown -R appuser:appgroup /app/backups /app/uploads

# SECURITY FIX: 2026-03-28 - Switch to non-root user
USER appuser

ENV NODE_ENV=production
ENV PORT=3001
ENV PUPPETEER_CACHE_DIR=/home/appuser/.cache/puppeteer

EXPOSE 3001

# SECURITY FIX: 2026-03-28 - Use prisma migrate deploy instead of db push
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npm run prisma:generate && npm run prisma:migrate:prod && node dist/main.js"]
