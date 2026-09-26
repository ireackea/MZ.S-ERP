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

RUN npm ci
RUN npx puppeteer browsers install chrome
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
