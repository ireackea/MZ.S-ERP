# ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
# ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
COPY nest-cli.json ./
COPY tsconfig.json ./
COPY tsconfig.run.json ./
COPY src ./src

RUN npm ci
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["sh", "-lc", "npx prisma generate && npx prisma db push && npm run prisma:seed && node dist/main.js"]