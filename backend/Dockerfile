# ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
# ENTERPRISE FIX: Phase 0 – التنظيف الأساسي والأمان الحرج - 2026-03-13
# ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    fonts-liberation \
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