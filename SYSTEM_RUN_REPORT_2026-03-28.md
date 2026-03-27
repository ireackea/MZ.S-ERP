# تقرير تشغيل النظام وحل الأعطال

**المشروع:** MZ.S-ERP  
**التاريخ:** 2026-03-28  
**البيئة:** Windows  
**نطاق التقرير:** تشغيل النظام بشكل رسمي، تحديد الأعطال، تنفيذ الحل، والتحقق من النتيجة النهائية

## 1) الملخص التنفيذي

تمت محاولة تشغيل النظام عبر المسار الرسمي الموثق في ملفات التشغيل والإنتاج. أثناء التنفيذ ظهرت عدة مشاكل متتابعة حالت دون الإقلاع المباشر عبر المسار الأصلي. تم تحديد الأسباب الجذرية وحلها عمليًا، ثم تم التحقق من أن backend والواجهة الأمامية يعملان بنجاح على المنافذ المطلوبة.

النتيجة النهائية:
- backend أصبح يعمل بنجاح ويعرض health endpoint و metrics endpoint.
- frontend أصبح يعمل بنجاح على منفذ العرض الإنتاجي.
- تم إصلاح خلل حقن NestJS داخل AuditModule.
- تم تهيئة قاعدة البيانات المحلية لتطابق إعدادات المشروع.

## 2) المسار الرسمي للتشغيل الذي تم اكتشافه

المسار المرجعي للتشغيل كان مبنيًا على:
- [START_PROD_ULTIMATE_v5.bat](START_PROD_ULTIMATE_v5.bat)
- [START_PROD_ULTIMATE_v4.bat](START_PROD_ULTIMATE_v4.bat)
- [docker-compose.prod.yml](docker-compose.prod.yml)
- سكربتات npm في [package.json](package.json)

ومن خلال المراجعة تبيّن أن:
- ملف v5 مجرد غلاف يستدعي v4.
- v4 ينفذ تسلسلًا إنتاجيًا يتضمن backup، ثم build كامل، ثم تشغيل Docker stack، ثم health checks.
- على هذه الآلة، Docker daemon لم يكن نشطًا، لذلك لم يكتمل المسار الرسمي بالحاويات.

## 3) المشاكل التي ظهرت بالتسلسل

### أ) Docker غير متاح فعليًا

تم فحص Docker على الجهاز، وظهر أن عميل Docker موجود لكن الاتصال بالـ daemon فشل. هذا يعني أن مسار الإنتاج المعتمد على الحاويات لا يمكن أن يبدأ هنا قبل تشغيل Docker Desktop أو خدمة Docker Engine.

الأثر:
- فشل `docker version` عمليًا في الوصول إلى المحرك.
- أي تشغيل يعتمد على `docker compose` لن ينجح حتى يتم تشغيل الخدمة.

### ب) تعارض قاعدة البيانات المحلية مع إعدادات المشروع

ملف البيئة الجذرية [\.env](.env) كان يوجّه التطبيق إلى PostgreSQL محلي باسم:
- database: `feed_factory_db`
- user: `feedfactory`

لكن قاعدة PostgreSQL المحلية الموجودة فعليًا كانت تابعة لتثبيت آخر على الجهاز، ولم تكن بيانات الاعتماد الخاصة بالمشروع متطابقة معها في البداية.

الأثر:
- `prisma migrate deploy` فشل بخطأ authentication.

### ج) تعارض Prisma migration history مع schema الحالي

بعد إصلاح الاعتماديات، ظهر خطأ Prisma من نوع `P3019` لأن ملف القفل:
- [backend/prisma/migrations/migration_lock.toml](backend/prisma/migrations/migration_lock.toml)

كان يعرّف provider على أنه `sqlite`، بينما المخطط الفعلي في [backend/prisma/schema.prisma](backend/prisma/schema.prisma) كان `postgresql`.

الأثر:
- `prisma migrate deploy` لم يعد قادرًا على متابعة سجل الهجرات الحالي.
- حدث تعارض في انتقال المشروع من SQLite التاريخي إلى PostgreSQL الحالي.

### د) خطأ في حقن NestJS داخل AuditModule

أثناء تشغيل backend ظهر خطأ dependency resolution داخل NestJS:
- `AuditService` يحتاج `PrismaService`
- `JwtAuthGuard` يحتاج `AuthService`

لكن [backend/src/audit/audit.module.ts](backend/src/audit/audit.module.ts) لم يكن يستورد `AuthModule`، ولم يكن يوفّر `PrismaService` ضمن نطاق الوحدة.

الأثر:
- backend لم يكن يستطيع الإقلاع رغم أن الكود كان يُبنى بنجاح.

## 4) طريقة الحل التي نُفذت

### أ) تهيئة PostgreSQL المحلي بالمستخدم والقاعدة المطلوبين

تم اكتشاف أن تثبيت Odoo المحلي يحتوي على PostgreSQL جاهز ويعمل على المنفذ 5432. بعد اختبار الوصول، تم إنشاء:
- role: `feedfactory`
- database: `feed_factory_db`

ثم تم ضبط كلمة المرور لتتطابق مع [\.env](.env).

### ب) إعادة مزامنة قاعدة البيانات مع Prisma schema الحالي

بسبب تعارض سجل الهجرات القديم، تم استخدام:
- `prisma db push --force-reset`

وهذا أعاد تهيئة قاعدة البيانات المحلية لتتطابق مع المخطط الحالي بدل الاعتماد على migration history المتعارض.

### ج) زراعة البيانات الأساسية

تم تشغيل seed script الخاص بالـ backend لإضافة الأدوار والمستخدمين الافتراضيين، بما في ذلك superadmin وmanager وviewer.

### د) إصلاح حقن NestJS في AuditModule

تم تعديل [backend/src/audit/audit.module.ts](backend/src/audit/audit.module.ts) كما يلي:
- إضافة `AuthModule` إلى imports
- إضافة `PrismaService` إلى providers

الهدف من ذلك:
- تمكين `JwtAuthGuard` من الوصول إلى `AuthService`
- تمكين `AuditService` من الوصول إلى `PrismaService`

## 5) التحقق النهائي الذي أثبت نجاح التشغيل

بعد الإصلاحات، تم التحقق من التالي:

- backend health endpoint يستجيب بنجاح على:
  - `http://localhost:3001/api/health`
- backend metrics endpoint يستجيب بنجاح على:
  - `http://localhost:3001/metrics`
- frontend يستجيب بنجاح على:
  - `http://localhost:4173`

كما تم التأكد من أن:
- `frontend/dist/index.html` تم إنتاجه بنجاح.
- `backend/dist/main.js` تم إنتاجه بنجاح.
- `npm run build:full` اكتمل بنجاح بعد التهيئة.

## 6) الأثر الفني لكل مشكلة

### Docker

كان العائق بيئيًا وليس برمجيًا. المشكلة لم تكن في المشروع نفسه بل في عدم تشغيل daemon على هذه الآلة.

### قاعدة البيانات

المشروع كان مبنيًا على PostgreSQL في المرحلة الحالية، لكن البيئة المحلية كانت تحتوي PostgreSQL مختلفًا بالإعدادات، لذلك احتاجت القاعدة إلى provisioning مطابق.

### Prisma

السبب الجذري هنا هو أن تاريخ الهجرات لم يعد متسقًا مع Provider الحالي. هذا النوع من المشاكل شائع عند الانتقال من SQLite إلى PostgreSQL أو عند إعادة هيكلة قواعد البيانات دون إعادة بناء migration history.

### NestJS DI

المشكلة كانت في حدود الوحدات Module boundaries. وجود service أو guard في المشروع لا يكفي؛ يجب أن تكون الخدمات التي يعتمد عليها متاحة داخل نفس module context أو imported modules.

## 7) الخلاصة النهائية

تمكّن النظام من الإقلاع فعليًا بعد:
- معالجة توفر قاعدة البيانات المحلية
- مزامنة Prisma schema مع PostgreSQL
- إصلاح Module wiring في NestJS

النتيجة النهائية كانت تشغيل backend وfrontend بنجاح، مع تحقق مباشر من الصحة والمقاييس وواجهة المستخدم.

## 8) ملاحظات مهمة للمستقبل

- إذا أُريد استخدام المسار الرسمي بالحاويات، يجب تشغيل Docker daemon أولًا.
- إذا أُريد أن يعمل `prisma migrate deploy` بدون `db push`, فيجب إعادة بناء migration history بحيث يطابق PostgreSQL بدل القفل القديم الذي ما زال يشير إلى SQLite.
- من الأفضل الاحتفاظ بمسار تشغيل موحّد وواضح في وثيقة تشغيل واحدة حتى لا تتكرر الفجوات بين bat launcher وnpm scripts وdocker compose.