# تقرير الفحص التقني القاسي - MZ.S-ERP

التاريخ: 2026-05-09  
النطاق: فحص تقني قاس قائم على الكود والبيئة الحالية، بدون تعديل بيانات تشغيلية وبدون تنفيذ reset/restore/import فعلي على بيانات المستخدم.  
السرية: لا يحتوي هذا التقرير على قيم `.env` أو كلمات مرور أو JWT خام. تم تعقيم artifact runtime الجديد وحذف ملف env المؤقت الذي أنشئ للفحص.

## 1. الحكم التنفيذي

الحكم العام: **YELLOW / High Remediation Required**.

النظام قابل للبناء والتشغيل الأساسي في بيئة معزولة، ونجح في فحوصات runtime الحساسة: health، metrics token، auth cookie flags، رفض endpoint محمي بلا جلسة، ورفض WebSocket anonymous. لكن الثقة المؤسسية لا تكتمل قبل معالجة نتائج static audit: 6 high، 64 medium، 7 low.

درجة النزاهة الآلية في static report كانت 0% لأن scoring صارم جدًا ويعاقب كل high finding تراكمياً. هذا لا يعني أن النظام لا يعمل، بل يعني أن بوابات الثقة التقنية لا تسمح باعتباره Enterprise-ready قبل معالجة findings عالية الخطورة.

## 2. منهجية الفحص

- جرد static للكود والملفات: frontend، backend، controllers، DTOs، Prisma، configs، tests.
- قراءة يدوية للملفات الحساسة: auth/RBAC، transactions، items/import، backup/restore، monitoring/reset، realtime، PDF، Docker.
- فحوصات آمنة فقط: build، audit analyzers، encoding، runtime isolated environment.
- Runtime audit تم تشغيله على Docker project مؤقت وقاعدة بيانات مؤقتة منفصلة ثم حذف الحاويات والـ volume.
- لم يتم تشغيل عمليات مغيرة لبيانات المستخدم: لا reset، لا restore، لا import فعلي على قاعدة بيانات المستخدم، ولا migrations على قاعدة البيانات الحالية.

## 3. الأدلة التنفيذية

| الفحص | النتيجة | الدليل |
|---|---:|---|
| Static audit | YELLOW، 6 high، 64 medium، 7 low | `audit-reports/surgical/manual-static-20260509/FINAL_SURGICAL_AUDIT_REPORT.md` |
| Runtime audit معزول | GREEN، 9/9 checks passed | `audit-reports/surgical/manual-runtime-20260509233506/FINAL_SURGICAL_AUDIT_REPORT.md` |
| Audit analyzer tests | PASS، 7/7 | `node scripts/audit/tests/analyzers.test.mjs` داخل Docker |
| Docker build | PASS، backend/frontend built | `docker compose build backend frontend` |
| Encoding check | PASS | `node scripts/check-text-encoding.mjs` داخل Docker |
| Cleanup | PASS | لا توجد حاويات `mzs-erp-runtime` أو `mzs-erp-audit` متبقية |

ملاحظة مهمة: host لا يحتوي `node/npm` على PATH، لذلك شُغّلت فحوصات Node عبر Docker.

## 4. مصفوفة التغطية

| المجال | التغطية | مستوى الثقة | ملاحظات |
|---|---|---:|---|
| Auth/JWT/session | كود + runtime | عال | cookie HttpOnly/SameSite نجح، endpoint محمي رجع 401 بلا جلسة |
| RBAC | كود + static | متوسط | guard يسمح بمرور endpoints بلا metadata؛ يحتاج سياسة deny-by-default |
| Items/import/upload | كود + static | عال | import يتحقق من required/duplicates/formula injection؛ upload filename يحتاج hardening |
| Transactions/balances | كود | متوسط | operations داخل transaction، لكن يوجد currentStock materialized يحتاج reconciliation |
| Backup/restore | كود | متوسط | التشفير جيد، لكن manual backup متزامن داخل request path |
| Monitoring/reset | كود + runtime | متوسط | reset متعدد البوابات؛ health يمر؛ CORS denial يرجع 500 |
| Realtime/WebSocket | كود + runtime | عال | anonymous/disallowed origin مرفوضان في runtime audit |
| PDF/reports | كود | متوسط | Puppeteer محمي جزئياً لكن HTML render يحتاج حدود وطابور/timeout |
| Docker/ops | كود + build | متوسط | prod compose فيه healthchecks؛ dev compose يفتقد backend healthcheck |
| Frontend state/UI | كود + static | متوسط | مكونات ضخمة جدًا وتزيد خطر regression |
| Tests | file inventory + analyzer tests | متوسط منخفض | توجد frontend/e2e tests، لكن backend coverage وCI gates غير كافية |
| Secrets/artifacts | grep آمن بدون طباعة قيم | متوسط | artifacts تاريخية تحتوي JWT cookies خام ويجب تعقيمها |

## 5. Findings مرتبة حسب الخطورة

### F-01 - High - ثغرات supply-chain في dependencies

الدليل: `audit-reports/surgical/manual-static-20260509/npm-audit.json`، و static report سجّل high vulnerabilities في root/frontend/backend.  
التفاصيل المختصرة: root فيه 3 high و8 moderate؛ frontend فيه 1 high و2 moderate؛ backend فيه 2 high و8 moderate. من أبرز الحزم: `axios`, `fast-uri`, `basic-ftp`, وحزم مترابطة عبر `prisma`/tooling.

السبب الجذري: الاعتماد على إصدارات قديمة أو نطاقات dependency تسمح بسلاسل vulnerable.  
الأثر: prototype pollution، header/request tampering، SSRF/no_proxy bypass، path traversal، DoS حسب الحزمة والمسار.  
الحل: ترقية dependencies وفق خطة مقيدة، تشغيل `npm audit --workspaces` في CI، واختبار auth/API/import بعد الترقية.  
التحقق: static audit يعود بدون high supply-chain findings، والبناء والـ runtime smoke ينجحان.

### F-02 - High - artifacts تاريخية تحتوي JWT cookies خام

الدليل: فحص آمن كشف وجود `feed_factory_jwt=...` في بعض `audit-reports/surgical/*/runtime-report.json` و`final-report.json` القديمة. لم يتم طباعة القيم في هذا التقرير. artifact runtime الجديد تم تعقيمه إلى `feed_factory_jwt=<redacted>`.

السبب الجذري: `scripts/audit/run-runtime-audit.mjs` يسجل Set-Cookie كاملًا داخل report عند فحص `auth-cookie-flags`.  
الأثر: إذا كانت artifacts محفوظة أو مرفوعة، قد تصبح tokens قابلة للاستغلال خلال فترة صلاحيتها أو تتحول إلى دليل تسريب أسرار في history.  
الحل: تعقيم كل artifacts التاريخية، تعديل audit engine ليخزن flags فقط لا قيمة cookie، وإضافة secret scanning gate.  
التحقق المطلوب بعد الإصلاح: لا يظهر أي JWT خام في `audit-reports` أو history، وتبقى تقارير runtime الجديدة عند مستوى flags فقط بدون قيمة cookie.

### F-03 - High - واجهات React ضخمة وغير قابلة للصيانة الآمنة

الدليل: static audit: `frontend/src/components/DailyOperations.tsx` = 4071 lines، `frontend/src/components/UnifiedIAM.tsx` = 944 lines، إضافة إلى مكونات كثيرة بين 497 و793 lines.

السبب الجذري: تراكم منطق workflow/render/state داخل مكونات ضخمة بدل hooks ومكونات أصغر.  
الأثر: أي تعديل في العمليات أو IAM أو التقارير يحمل خطر regression عالي، وصعوبة إضافة اختبارات دقيقة، وصعوبة مراجعة صلاحيات الواجهة.  
الحل: تقسيم تدريجي حسب bounded contexts: hooks للبيانات، components للعرض، adapters للخدمات، واختبارات لكل workflow.  
التحقق: انخفاض المكونات الحرجة تحت threshold متفق عليه، وزيادة اختبارات interaction.

### F-04 - High - RBAC يسمح افتراضياً لأي endpoint بلا metadata

الدليل: `backend/src/auth/rbac.guard.ts` يرجع `true` إذا لم توجد `@Permissions` أو `@Roles`. static audit وجد endpoints authenticated بلا permission صريح مثل `/app/bootstrap`, `/auth/me`, `/users/permissions/me`, `/unloading-rules`.

السبب الجذري: سياسة allow-by-default داخل RbacGuard بعد نجاح authentication.  
الأثر: أي endpoint جديد ينسى decorator يصبح متاحاً لأي مستخدم authenticated، وهذا نمط خطر في ERP.  
الحل: اعتماد deny-by-default أو decorator صريح مثل `@AllowAuthenticated()` للمسارات العامة بعد login.  
التحقق: static audit لا يعرض `missing-endpoint-permission` إلا لمسارات موثقة ومقبولة.

### F-05 - Medium/High - النسخ الاحتياطي اليدوي متزامن داخل HTTP request

الدليل: `backend/src/backup/backup.controller.ts` ينتظر `backupService.createBackup(...)` في endpoints مثل `POST backup/full`، و`backup.service.ts` يبني snapshot ويكتب ملف backup داخل نفس الطلب.  
المخالفة المعمارية: تعليمات المشروع تنص أن backup functions يجب أن تكون async/background jobs.

السبب الجذري: عدم وجود job queue أو worker layer للنسخ والاستعادة.  
الأثر: طلبات backup الكبيرة قد تحجز event loop/DB pool، تسبب timeout، وتضغط الذاكرة أثناء snapshot.  
الحل: تحويل backup/create/restore preview إلى jobs مع queue status، progress، cancellation، وحدود concurrent jobs.  
التحقق: HTTP endpoint يرجع jobId سريعاً، والعملية تكتمل في worker مع audit trail.

### F-06 - Medium - CORS disallowed origin يرجع 500 بدل رفض منضبط

الدليل: runtime audit نجح في منع `Access-Control-Allow-Origin` للـ origin غير المسموح، لكن status كان 500 في check `cors-denied-origin`. الكود في `backend/src/main.ts` يستخدم `callback(new Error('Not allowed by CORS'))`.

السبب الجذري: رفض CORS عبر Error خام يؤدي إلى HTTP 500 بدلاً من رفض مضبوط.  
الأثر: noisy logs، false alarms في monitoring، وصورة تشغيلية غير واضحة.  
الحل: middleware/exception handling يعيد 403 أو response بدون CORS header بطريقة متوقعة.  
التحقق: disallowed origin لا يأخذ CORS header ويرجع status مضبوط غير 500.

### F-07 - Medium - logging حساس في auth/session flows

الدليل: static audit وجد `sensitive-console-logging` في `backend/src/auth/auth.service.ts`, `backend/src/main.ts`, `frontend/src/services/authService.ts`, `frontend/src/App.tsx`, و`backend/prisma/seed.ts` حيث يظهر logging للـ username/role/permissions وربما password seed في مسارات seed.

السبب الجذري: استخدام `console.*` مباشر في flows حساسة بدل logger منضبط مع redaction.  
الأثر: تسريب أسماء مستخدمين، أدوار، permissions، رسائل أخطاء backend، وربما قيم حساسة في logs أثناء seed.  
الحل: structured logger مع redaction، إزالة client-side auth payload logs، ومنع طباعة passwords في seed.  
التحقق: static audit لا يسجل sensitive-console-logging في auth flows.

### F-08 - Medium - محرك runtime audit نفسه يخزن cookie كامل

الدليل: `scripts/audit/run-runtime-audit.mjs` يضيف `cookie: authCookie` داخل check `auth-cookie-flags`.  
السبب الجذري: التقرير يحفظ قيمة الإثبات كاملة بدل خصائص الإثبات.

الأثر: كل تشغيل runtime audit قد ينتج artifact يحتوي token صالحاً مؤقتاً.  
الحل: حفظ `{ hasCookie, httpOnly, sameSite, secure }` فقط، أو redaction قبل writeJson.  
التحقق: artifacts الجديدة لا تحتوي JWT خام حتى قبل أي تنظيف يدوي.

### F-09 - Medium - PDF/HTML render قابل لضغط موارد

الدليل: `RenderHtmlPdfDto.html` في `backend/src/report/dto/print-report.dto.ts` لا يملك `@MaxLength`، بينما `main.ts` يسمح body حتى 10MB، و`report.service.ts` يشغل Puppeteer لكل request.  
الإيجابي: JavaScript disabled في `renderHtmlPdf`، وبعض حدود rows موجودة في printable PDF.

السبب الجذري: غياب queue/timeouts/size caps دقيقة لمسار render HTML.  
الأثر: DoS عبر HTML كبير أو CSS/images معقدة، وارتفاع memory/CPU.  
الحل: `@MaxLength`, timeout على page/pdf، browser pool أو job queue، rate limit خاص للتقارير، وتعقيم HTML/CSS حسب الحاجة.  
التحقق: load test محدود للتقارير، وفشل الطلبات الكبيرة برسالة 413/400 قبل Puppeteer.

### F-10 - Medium - ازدواجية مصدر الحقيقة في أرصدة المخزون

الدليل: `TransactionService` يحدث `Item.currentStock` عند create/update/delete، ويوجد أيضاً `getComputedBalances` يحسب من opening balances + transactions. Import يسمح بإدخال `currentStock` عند إنشاء الأصناف.

السبب الجذري: وجود ledger محسوب وmaterialized stock في نفس الوقت دون reconciliation invariant معلن.  
الأثر: drift بين الرصيد المخزن والرصيد المحسوب عند import، rollback، restore، أو أخطاء جزئية.  
الحل: اعتماد ledger كمصدر حقيقة أو materialized view بتحديث/reconciliation job، مع تقرير فروقات يومي وقيود تمنع drift.  
التحقق: اختبار يقارن currentStock مع computed balance بعد create/update/delete/import/restore.

### F-11 - Medium - رفع مرفقات الأصناف يحتاج hardening للاسم والمسار

الدليل: `backend/src/item/item.service.ts` يبني `fileName` من `file.originalname` مباشرة.  
السبب الجذري: الاعتماد على اسم ملف العميل في اسم التخزين بدون sanitization واضحة في هذا الموضع.  
الأثر: أسماء غريبة، path separator edge cases، مشاكل download/display، وصعوبة تنظيف الملفات.  
الحل: استخدام basename آمن، whitelist للامتدادات/MIME، حد حجم، فحص محتوى، وتخزين اسم العرض منفصلاً عن اسم التخزين.  
التحقق: اختبارات upload بأسماء تحتوي مسارات ورموز Unicode وامتدادات مزدوجة.

### F-12 - Medium - dev compose لا يملك healthcheck للـ backend

الدليل: `docker-compose.prod.yml` يملك healthchecks، لكن `docker-compose.yml` يكتفي بـ `depends_on` بدون health condition.  
السبب الجذري: فرق بين التشغيل التطويري والتشغيل الإنتاجي.  
الأثر: أخطاء race عند طلب `/api/health` مباشرة بعد restart، وهي المشكلة التي ظهرت سابقاً في الجلسة.  
الحل: إضافة backend healthcheck في dev compose أو توحيد launcher waits/retries.  
التحقق: `docker compose up -d` ثم health wait ينجح بدون false failure.

### F-13 - Medium - غياب lint pipeline وbackend test gate واضح

الدليل: static audit سجل `lint-pipeline-missing`; root scripts لا تحتوي lint، وbackend package لا يحتوي test script. توجد اختبارات frontend وe2e لكنها لا تغطي backend services بشكل كاف.  
السبب الجذري: الاعتماد على build/static audit أكثر من quality gates يومية.  
الأثر: type-safety hotspots وconsole logging وRBAC drift قد تمر دون منع في CI.  
الحل: ESLint shared config، backend unit/integration tests، coverage thresholds، وCI على build/test/audit.  
التحقق: PR لا يمر بدون lint/test/audit clean أو waivers موثقة.

### F-14 - Medium - type-safety hotspots تقلل ثقة المراجعة

الدليل: static audit سجل `any-hotspot` في `backend/src/monitoring/monitoring.service.ts` بعدد 16، وفي controllers/services أخرى.  
السبب الجذري: `any` في request/user/dynamic Prisma/model optional paths.  
الأثر: أخطاء authorization/data shape قد لا يلتقطها TypeScript.  
الحل: تعريف `AuthenticatedRequest`, `SystemResetUser`, DTOs وguards typed، واستخدام `unknown` مع narrowing.  
التحقق: خفض hotspots وإضافة قواعد ESLint تمنع `any` إلا بتعليق waiver.

### F-15 - Low/Medium - ملفات `.env` محلية موجودة على القرص

الدليل: static audit سجل وجود `.env` و`backend/.env` دون عرض القيم.  
السبب الجذري: بيئة تشغيل محلية تعتمد ملفات أسرار.  
الأثر: خطر تسريب إذا أضيفت للـ git أو دخلت في artifacts.  
الحل: التأكد من `.gitignore`، استخدام `.env.example` بلا قيم، وتشغيل secret scanning قبل commit.  
التحقق: no tracked env secrets، وsecret scan clean.

## 6. نقاط قوة مهمة

- `ValidationPipe` عام مع `whitelist` و`forbidNonWhitelisted` و`transform` يقلل payload drift.
- JWT عبر httpOnly cookie وليس localStorage token، وruntime تحقق من `HttpOnly` و`SameSite=Strict`.
- metrics محمي بـ token في runtime audit.
- WebSocket realtime يرفض anonymous وdisallowed origin في runtime audit.
- معاملات stock deltas في `TransactionService` داخل Prisma transaction عند create/update/delete.
- Import للأصناف يرفض Excel formula injection في حقول نصية، ويضع حد 15000 صف.
- Docker backend production يستخدم non-root user وhealthcheck.
- System reset يحتوي دور SuperAdmin، token، challenge مؤقت، cooldown، وpre-reset backup best-effort.

## 7. خارطة الطريق

### 0-30 يوم

1. ترقية dependencies ذات high severity وإعادة build/runtime audit.
2. تعقيم artifacts التاريخية التي تحتوي JWT cookies، وتعديل runtime audit ليحجب cookie تلقائياً.
3. إزالة logging الحساس من auth/frontend/seed.
4. إضافة healthcheck إلى `docker-compose.yml` أو توحيد launcher wait/retry.
5. إقرار سياسة RBAC: deny-by-default أو `@AllowAuthenticated()` صريح.

### 31-90 يوم

1. تحويل backup اليدوي إلى background jobs.
2. إضافة ESLint + backend tests + CI gates.
3. تقسيم `DailyOperations.tsx` و`UnifiedIAM.tsx` إلى modules/hooks.
4. hardening مسارات upload وPDF render.
5. إنشاء reconciliation report بين `Item.currentStock` وcomputed ledger.

### 3-6 أشهر

1. إدخال Observability كاملة: request IDs، OpenTelemetry، dashboards، alerts.
2. إنشاء integration tests للـ stock ledger، restore، RBAC، import، realtime.
3. توثيق module boundaries وخريطة permissions/backend decorators.
4. إضافة performance baselines للتقارير وعمليات bulk.

### 6-12 شهر

1. نقل العمليات الثقيلة: import/PDF/backup/restore إلى queue/worker architecture.
2. بناء outbox pattern للأحداث وrealtime لضمان عدم فقد الإشعارات بعد commit.
3. إضافة audit retention policy وتصدير آمن للسجلات.
4. إعداد disaster recovery drill ربع سنوي مع restore verification.

## 8. تحسينات 3-5 سنوات

1. **Ledger-first inventory architecture**: جعل الحركات هي مصدر الحقيقة، والأرصدة materialized views قابلة لإعادة البناء.
2. **Event-driven operations**: outbox + workers + idempotency keys لكل import/transaction/backup.
3. **Zero-trust deployment**: managed secrets، network segmentation، least-privilege DB user، وWAF/reverse proxy policies.
4. **Enterprise observability**: traces/logs/metrics مركزية، SLOs، anomaly detection للأرصدة والحركات.
5. **CI/CD compliance gates**: SCA، secret scanning، SAST، IaC scanning، dependency pinning، SBOM.
6. **Operational analytics**: إنذارات نقص المخزون، توقع الاستهلاك، مراقبة تأخير التفريغ والغرامات.
7. **Industrial integrations**: باركود/ميزان/IoT مع queue resilient وoffline reconciliation.
8. **UX modular workstation**: شاشات عمليات كثيفة لكن مفصولة، keyboard-first، وقابلة للعمل المتكرر دون بطء.

## 9. قيود الفحص

- لم تتوفر وثائق متطلبات رسمية أو سجلات إنتاج أو شكاوى مستخدمين؛ لذلك بعض تقديرات functional correctness تعتمد على الكود الحالي فقط.
- لم يتم تشغيل load test أو browser manual walkthrough كامل لكل شاشة.
- لم يتم تشغيل `npm run build:full` محلياً لأن `node/npm` غير متوفرين على PATH؛ تم التعويض بـ Docker build وفحوصات Node داخل Docker.
- runtime audit شغّل backend/Postgres في بيئة مؤقتة معزولة، ولم يشغل frontend browser walkthrough.
- لم يتم إجراء secret scan رسمي عبر GitHub MCP لأن الطلب الحالي لم يكن طلب secret scanning صريح، لكن تم تسجيل مؤشرات تسريب artifacts بناءً على grep آمن دون طباعة القيم.

## 10. قرار الجودة النهائي

لا أوصي باعتبار النظام Enterprise-ready بشكل كامل قبل معالجة F-01 إلى F-08 على الأقل.  
أوصي بقبول النظام كبيئة تطوير/اختبار قابلة للعمل بعد البناء الناجح، مع منع نشر production جديد حتى تنتهي supply-chain remediation، تعقيم artifacts، وسياسة RBAC الصريحة.
