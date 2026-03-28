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
COPY nest-cli.json ./
COPY tsconfig.json ./
COPY tsconfig.run.json ./
COPY src ./src

RUN npm ci --only=production=false
RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:20-bookworm-slim AS production

WORKDIR /app

# SECURITY FIX: 2026-03-28 - Install minimal runtime dependencies only
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
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

# SECURITY FIX: 2026-03-28 - Create backups directory with proper permissions
RUN mkdir -p /app/backups && chown -R appuser:appgroup /app/backups

# SECURITY FIX: 2026-03-28 - Switch to non-root user
USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# SECURITY FIX: 2026-03-28 - Use prisma migrate deploy instead of db push
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/dashboard/stats || exit 1

CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node dist/main.js"]
