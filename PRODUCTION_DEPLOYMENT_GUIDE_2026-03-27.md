# MZ.S-ERP - Production Deployment Guide

**الإصدار**: v6.0 Ultimate  
**تاريخ النشر**: 2026-03-27  
**الحالة**: ✅ Production-Ready

---

## 📑 جدول المحتويات

1. [المتطلبات الأساسية](#1-المتطلبات-الأساسية)
2. [التحضير للنشر](#2-التحضير-للنشر)
3. [النشر باستخدام Docker](#3-النشر-باستخدام-docker)
4. [النشر اليدوي (بدون Docker)](#4-النشر-اليدوي-بدون-docker)
5. [إعداد قاعدة البيانات](#5-إعداد-قاعدة-البيانات)
6. [النسخ الاحتياطي](#6-النسخ-الاحتياطي)
7. [المراقبة والصيانة](#7-المراقبة-والصيانة)
8. [استكشاف الأخطاء](#8-استكشاف-الأخطاء)

---

## 1. المتطلبات الأساسية

### 1.1 الحد الأدنى للموارد

| المكون | الحد الأدنى | الموصى به |
|--------|-------------|-----------|
| **CPU** | 2 Core | 4 Core |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 20 GB | 50 GB SSD |
| **Network** | 10 Mbps | 100 Mbps |

### 1.2 البرمجيات المطلوبة

```bash
# Node.js 18+
node --version  # v18.x أو أحدث

# npm 9+
npm --version  # v9.x أو أحدث

# Docker (اختياري للنشر بالحاويات)
docker --version  # v24.x أو أحدث

# PostgreSQL (للإنتاج)
psql --version  # v15.x أو أحدث
```

### 1.3 المنافذ المطلوبة

| المنفذ | الخدمة | الوصول |
|--------|--------|--------|
| 3001 | Backend API | داخلي/خارجي |
| 4173 | Frontend | داخلي/خارجي |
| 5432 | PostgreSQL | داخلي فقط |
| 80 | Nginx (اختياري) | خارجي |

---

## 2. التحضير للنشر

### 2.1 استنساخ المستودع

```bash
git clone <repository-url> MZ.S-ERP
cd MZ.S-ERP
```

### 2.2 إنشاء ملف .env

```bash
# نسخ الملف النموذجي
cp .env.example .env

# تحرير ملف .env
nano .env
```

### 2.3 محتوى ملف .env

```env
# Database
DATABASE_URL=postgresql://feedfactory:SecurePassword2026!@localhost:5432/feed_factory_db
DATABASE_DIRECT_URL=postgresql://feedfactory:SecurePassword2026!@localhost:5432/feed_factory_db

# Security
JWT_SECRET=phase-6-production-secret-key-2026-change-me
PORT=3001

# CORS
CORS_ORIGINS=http://localhost:4173,http://your-domain.com
ALLOW_CODESPACES_ORIGINS=false

# Admin Password (للـ Seed الأولي)
ADMIN_PASSWORD=SecurePassword2026!
```

### 2.4 تثبيت التبعيات

```bash
# تثبيت التبعيات الرئيسية
npm install

# تثبيت التبعيات في backend
cd backend && npm install && cd ..

# تثبيت التبعيات في frontend
cd frontend && npm install && cd ..
```

---

## 3. النشر باستخدام Docker

### 3.1 التحضير

```bash
# التأكد من تشغيل Docker
docker --version
docker compose version

# إنشاء مجلدات البيانات
mkdir -p backend/uploads
chmod 755 backend/uploads
```

### 3.2 تعديل docker-compose.prod.yml

```yaml
services:
  backend:
    environment:
      DATABASE_URL: postgresql://feedfactory:SecurePassword2026!@postgres:5432/feed_factory_db
      JWT_SECRET: ${JWT_SECRET}
      PORT: 3001
    volumes:
      - prisma-data:/app/prisma
      - backups-data:/app/backups
      - ./backend/uploads:/app/backend/uploads  # Phase 6: Uploads Volume
```

### 3.3 تشغيل النظام

```bash
# بناء وتشغيل الحاويات
docker compose -f docker-compose.prod.yml up -d --build

# مراقبة السجلات
docker compose -f docker-compose.prod.yml logs -f

# التحقق من الصحة
docker compose -f docker-compose.prod.yml ps
```

### 3.4 التحقق من التشغيل

```bash
# اختبار Backend
curl http://localhost:3001/api/health

# اختبار Frontend
curl http://localhost:4173

# اختبار Metrics
curl http://localhost:3001/metrics
```

### 3.5 إيقاف النظام

```bash
# إيقاف مؤقت
docker compose -f docker-compose.prod.yml stop

# إيقاف وحذف
docker compose -f docker-compose.prod.yml down

# إيقاف وحذف مع volumes (⚠️ يحذف البيانات)
docker compose -f docker-compose.prod.yml down -v
```

---

## 4. النشر اليدوي (بدون Docker)

### 4.1 تثبيت PostgreSQL

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Windows: تحميل من https://www.postgresql.org/download/windows/
```

### 4.2 إعداد قاعدة البيانات

```bash
# الدخول إلى PostgreSQL
sudo -u postgres psql

# إنشاء قاعدة البيانات والمستخدم
CREATE DATABASE feed_factory_db;
CREATE USER feedfactory WITH PASSWORD 'SecurePassword2026!';
GRANT ALL PRIVILEGES ON DATABASE feed_factory_db TO feedfactory;
\q
```

### 4.3 بناء Backend

```bash
cd backend

# توليد Prisma Client
npx prisma generate

# تشغيل Migrations
npx prisma migrate deploy

# بناء المشروع
npm run build

# العودة للجذر
cd ..
```

### 4.4 بناء Frontend

```bash
cd frontend

# بناء المشروع
npm run build

# العودة للجذر
cd ..
```

### 4.5 تشغيل Backend

```bash
cd backend

# تشغيل بالإنتاج
npm run start:prod

# أو باستخدام PM2
pm2 start dist/main.js --name mz-s-erp-backend -i max
```

### 4.6 تشغيل Frontend

```bash
cd frontend

# تشغيل بالإنتاج
npm run preview -- --host 0.0.0.0 --port 4173
```

### 4.7 تشغيل باستخدام START_PROD_ULTIMATE_v5.bat (Windows)

```batch
#双击 تشغيل
START_PROD_ULTIMATE_v5.bat

# أو من Command Prompt
.\START_PROD_ULTIMATE_v5.bat
```

---

## 5. إعداد قاعدة البيانات

### 5.1 Prisma Migrations

```bash
# تطوير (تطوير migrations جديدة)
cd backend
npx prisma migrate dev --name <migration_name>

# إنتاج (تطبيق migrations الموجودة)
npx prisma migrate deploy

# توليد Prisma Client
npx prisma generate
```

### 5.2 Seed البيانات الأولية

```bash
cd backend
npm run prisma:seed
```

### 5.3 بيانات الدخول الافتراضية

| المستخدم | كلمة المرور | الدور |
|----------|-------------|-------|
| superadmin | SecurePassword2026! | SuperAdmin |
| manager | SecurePassword2026! | Manager |
| viewer | SecurePassword2026! | Viewer |

---

## 6. النسخ الاحتياطي

### 6.1 النسخ الاحتياطي التلقائي

```bash
# نظام النسخ الاحتياطي موجود في:
backend/src/backup/backup.service.ts

# يتم تشغيل النسخ الاحتياطي كل 24 ساعة
# الملفات تحفظ في: backend/backups/
```

### 6.2 النسخ الاحتياطي اليدوي

```bash
# PostgreSQL Backup
pg_dump -U feedfactory feed_factory_db > backup_$(date +%Y%m%d).sql

# استعادة من النسخ الاحتياطي
psql -U feedfactory feed_factory_db < backup_20260327.sql
```

### 6.3 Prisma Backup

```bash
# تصدير البيانات
cd backend
npx prisma db seed

# نسخ مجلد prisma
cp -r prisma prisma.backup
```

---

## 7. المراقبة والصيانة

### 7.1 مراقبة الصحة

```bash
# Backend Health
curl http://localhost:3001/api/health

# Prometheus Metrics
curl http://localhost:3001/metrics

# Docker Health
docker compose -f docker-compose.prod.yml ps
```

### 7.2 عرض السجلات

```bash
# Backend Logs
docker compose -f docker-compose.prod.yml logs backend

# Frontend Logs
docker compose -f docker-compose.prod.yml logs frontend

# Logs المباشرة
tail -f production.log
```

### 7.3 Audit Logs

```
الدخول إلى: Settings → Audit Logs
URL: http://localhost:4173/settings?page=audit

الميزات:
- عرض جميع العمليات
- تصفية حسب الإجراء/الكيان/التاريخ
- تصدير CSV
- Real-time Updates
```

### 7.4 الصيانة الدورية

```bash
# أسبوعياً: تنظيف السجلات القديمة
# شهرياً: نسخ احتياطي خارجي
# سنوياً: تحديث التبعيات والأمان
```

---

## 8. استكشاف الأخطاء

### 8.1 المشاكل الشائعة

#### النظام لا يعمل بعد التشغيل

```bash
# التحقق من المنافذ
netstat -ano | findstr :3001
netstat -ano | findstr :4173

# قتل العمليات المعلقة
taskkill /PID <PID> /F

# إعادة التشغيل
.\START_PROD_ULTIMATE_v5.bat
```

#### خطأ في قاعدة البيانات

```bash
# التحقق من اتصال قاعدة البيانات
cd backend
npx prisma db pull

# إعادة توليد Prisma Client
npx prisma generate

# التحقق من migrations
npx prisma migrate status
```

#### خطأ في المصادقة

```bash
# إعادة تعيين كلمة المرور
# 1. حذف جميع المستخدمين (⚠️ خطر)
# 2. إعادة تشغيل النظام
# 3. سيتم إنشاء المستخدمين الافتراضيين

# أو استخدام RESET_TOKEN في .env
RESET_TOKEN=CONFIRM_SYSTEM_RESET_2026
```

#### خطأ في الـ Build

```bash
# مسح node_modules
rm -rf node_modules
rm -rf backend/node_modules
rm -rf frontend/node_modules

# إعادة التثبيت
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# إعادة البناء
npm run build:full
```

### 8.2 الحصول على المساعدة

```
1. راجع ملف production.log
2. تحقق من Docker logs
3. راجع السجلات في Settings → Audit Logs
4. اتصل بفريق الدعم
```

---

## 📞 الدعم الفني

**البريد الإلكتروني**: support@mz-s-erp.local  
**الهاتف**: +966-XXX-XXXX  
**ساعات العمل**: الأحد - الخميس 9:00 - 17:00

---

**تم إعداد هذا الدليل بواسطة**: Senior DevOps & Project Architect  
**تاريخ الإصدار**: 2026-03-27  
**الإصدار**: v6.0 Ultimate
