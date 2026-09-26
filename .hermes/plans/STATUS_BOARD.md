# MZ.S-ERP — لوحة الحالة الحية

> المصدر الميكانيكي: `EXECUTION_LEDGER.yaml`. هذه اللوحة ملخص قابل للقراءة، والـledger يفوز عند التعارض.

## الملخص

| ID | الحالة | آخر إثبات |
|---|---|---|
| FND-001 | TESTED | deployment contract 5/5، compose config، build:full |
| FND-004 | TESTED | prisma config contract 5/5، generate + validate |
| FND-002 | TESTED | storage inventory/guard 3/3، audit 37/37، ADR |
| DATA-001 | TESTED | إنّ ضمّت طبقة Decimal واحدّد الحد: نص DTO وسيستيريزيشن (string لا عددٍ/فلوات) — unit 28/28، contract 10/10، E2E 5/5 (0.100 لا 0.0999...) |
| DATA-002 | TESTED | Cairo boundary tests 4/4، audit 34/34، E2E regressions |
| DATA-003 | TESTED | domain E2E 1/1، stock reconciliation E2E 1/1، regression E2E 6/6، audit 41/41، Docker health |
| DATA-004 | TESTED | offline queue E2E 1/1، contract 4/4، frontend 39/39، audit 49/49، Docker health |
| INV-001 | TESTED | inventory boundary: audit 29/29، E2E 2/2، typecheck/build |
| INV-002 | TESTED | stock adjustment E2E 1/1، reconciliation، audit 32/32 |
| API-001 | TESTED | official Items CRUD E2E 1/1، API contract 4/4، audit 45/45، Docker health |
| API-002 | TESTED | report contract 20/20، API-002 contract 8/8، report E2E 4/4 (كشف ReportDto معطل)، audit 98/98 |
| SEC-001 | TESTED | scope E2E 1/1، scope unit 2/2، SEC contract 5/5، audit 54/54، Docker health |
| SEC-002 | TESTED | catalog unit 9/9، SEC-002 contract 9/9 (drift محقق)، RBAC E2E 3/3، audit 74/74 |
| SEC-003 | TESTED | SEC-003 contract 11/11 (اختراق محقق)، regression E2E 14/14، audit 74/74، setup 409/400 |
| AUD-001 | TESTED | redaction unit 6/6، AUD contract 9/9، audit-durability E2E 5/5، audit 98/98 |
| ITEM-001 | TESTED | attachment safety 15/15، ITEM contract 7/7، attachments E2E 4/4، audit 98/98 |
| OPS-001 | TESTED | pg-dump unit 10/10، OPS contract 9/9 (تراجع محقق)، backup round-trip E2E 5/5 على قاعدة حيّة، audit 107/107 |
| QA-001 | TESTED | بوابة CI واحدة: عقدة البوابات موحّدة (`ci:verify`)، اختبار البوابات 10/10، عقدة عقد 8/8، `npm test` يشغّل البكند أيضاً |
| QA-002 | TESTED | إثبات حية: HTTP 30/30، عقد البيئة مرتبطة + عداد عمود المرجع الحيي؛ إصلاح طريح: باترة manifest تمنعت كل استعادة HTTP |
| REF-001 | OPTIONAL | P2 ، لا يُعلّق بإطلاق بالشهادة؛ يُوفّر كبطافة دون تكبسا، بشروط `transaction.service.ts` و`item.service.ts` |
| DEF-001 | TESTED | المخزون لا يُستنبط سالباً: عجزماً مدروسة ومربطة دفترادً، والوارد يسدّد العجز قبل أن يصبر — ثابت `stock = ledger + عجز` — unit 14/14، contract 11/11، E2E 5/5 |
| CERTIFY-001 | ACCEPTED | قرار مقبول مخاطر بملاك المالك: المراجعة الذاتية أنقاضت خمس ثغرةاً، وليست مراجعة مستقلّلة؛ CI 10/10، E2E 43/43، أخطار 5 (خثقة أمان رقينة) |

## قاعدة الانتقال

`PLANNED → CODED → TESTED → VERIFIED → ACCEPTED`

لا يُنتقل إلى `VERIFIED` إلا بإعادة الفحص في جلسة/سياق تحقق مستقل. لم تُستخدم كلمة `ACCEPTED` لأي بطاقة في هذه الجولة.
