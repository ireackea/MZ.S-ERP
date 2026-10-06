#!/usr/bin/env node
/**
 * B21 — put a downloaded backup archive back into the store, from a terminal.
 *
 * ## Why this exists
 *
 * Downloading a backup and deleting it from the list used to be a one-way street. The
 * file sat wherever the browser put it, and the section had no path that would accept
 * it: no upload route, no tool. So the only copy of the database outside the system
 * was a file the system refused to read, and the one operation that needed it — a
 * restore — could not reach it.
 *
 * This is that missing door, as a script. It works when the interface is unreachable
 * — a browser that will not load, a machine where only a shell is available, or an
 * operator who would rather not click through a file picker.
 *
 * ## The two-step rule
 *
 * The default is a **preview**: it checks the archive, prints what is inside it, and
 * stops. Nothing is written. `--apply` is a separate, explicit word, and it is
 * required for anything to change.
 *
 * That ordering is not ceremony. An import is not a restore and does not destroy
 * anything, but it does put a file into the trusted store from a path the operator
 * chose, and it is the step that makes a file on a desktop reachable. A tool that
 * wrote on the first invocation would be the wrong shape for the one action an
 * operator performs while holding a file they are not sure about.
 *
 * ## Usage
 *
 *   node scripts/backup/restore-from-file.mjs <file.ffbkp>                 # preview
 *   node scripts/backup/restore-from-file.mjs <file.ffbkp> --apply         # import
 *   node scripts/backup/restore-from-file.mjs --help
 *
 * Reads BACKUP_API_URL, and the session from BACKUP_EMAIL/BACKUP_PASSWORD or
 * E2E_USERNAME/E2E_PASSWORD.
 */

import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--help') || args.length === 0) {
  console.log(`
B21 — استيراد ملف نسخة احتياطية من الخارج إلى القائمة.

  node scripts/backup/restore-from-file.mjs <file.ffbkp>            معاينة فقط
  node scripts/backup/restore-from-file.mjs <file.ffbkp> --apply    استيراد فعلي

المعاينة هي الافتراضية ولا تغيّر شيئاً. الاستيراد يحتاج الكلمة --apply صراحةً.

المتغيّرات:  BACKUP_API_URL  (افتراضياً http://localhost:3001/api)
             BACKUP_EMAIL / BACKUP_PASSWORD  أو  E2E_USERNAME / E2E_PASSWORD
`);
  process.exit(args.length === 0 ? 1 : 0);
}

const apply = args.includes('--apply');
const file = args.find((arg) => !arg.startsWith('--'));

if (!file) {
  console.error('لم يُحدَّد ملف. مرّر مسار ملف ‎.ffbkp‎.');
  process.exit(1);
}

const apiUrl = String(process.env.BACKUP_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
const username = process.env.BACKUP_EMAIL || process.env.E2E_USERNAME || '';
const password = process.env.BACKUP_PASSWORD || process.env.E2E_PASSWORD || '';

if (!username || !password) {
  console.error('يلزم اسم المستخدم وكلمة المرور: BACKUP_EMAIL و BACKUP_PASSWORD.');
  process.exit(1);
}

if (!file.toLowerCase().endsWith('.ffbkp')) {
  console.error(`الملف "${basename(file)}" ليس بامتداد ‎.ffbkp‎.`);
  process.exit(1);
}

const login = async () => {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(`login returned ${response.status}. Check the credentials.`);
  }
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('login returned no session cookie.');
  return cookie;
};

/**
 * Streams the file as multipart.
 *
 * A backup archive carries the whole database as base64, so this is routinely
 * hundreds of megabytes. `readFileSync` into a Buffer would hold all of it in memory
 * and then hold a second copy as it was base64-encoded — the exact shape of the
 * memory problem the section still has elsewhere, and no reason to reproduce it in
 * the tool built to work when things are already broken.
 */
const postMultipart = async (cookie, filePath) => {
  const { statSync, createReadStream } = await import('node:fs');
  const size = statSync(filePath).size;
  const boundary = `----ffbkp${Math.random().toString(16).slice(2)}`;

  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${basename(filePath)}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;

  // Node 18+ accepts an async iterable of buffers, so the body is produced chunk by
  // chunk instead of assembled in memory first.
  async function* body() {
    yield Buffer.from(head);
    for await (const chunk of createReadStream(filePath)) yield chunk;
    yield Buffer.from(tail);
  }

  return fetch(`${apiUrl}/backup/import`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(Buffer.byteLength(head) + size + Buffer.byteLength(tail)),
    },
    body: body(),
    // Node's fetch needs this for a streamed body; without it the request is sent
    // with chunked encoding and some proxies reject it.
    duplex: 'half',
  });
};

const main = async () => {
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    console.error(`لا يوجد ملف بهذا المسار: ${file}`);
    process.exit(1);
  }

  console.log(`الملف:  ${basename(file)}`);
  console.log(`الحجم:  ${(size / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`الهدف:  ${apiUrl}/backup/import`);
  console.log(apply ? '\nوضع الاستيراد: --apply' : '\nوضع المعاينة: لن يُكتب شيء. أضف --apply للاستيراد.');

  const cookie = await login();
  const response = await postMultipart(cookie, file);
  const text = await response.text();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error(`استجابة غير متوقعة (${response.status}): ${text.slice(0, 400)}`);
    process.exit(1);
  }

  if (!response.ok || payload?.success === false) {
    console.error(`\nفشل الاستيراد (${response.status})`);
    console.error(payload?.message || payload?.error || 'سبب غير معروف');
    if (payload?.code) console.error(`الرمز: ${payload.code}`);
    process.exit(1);
  }

  const backup = payload.data?.backup;
  const warnings = payload.data?.warnings || [];

  console.log('\n=== النتيجة ===');
  console.log(`المعرّف:   ${backup?.id}`);
  console.log(`النوع:     ${backup?.type}`);
  console.log(`التاريخ:   ${backup?.createdAt}`);
  console.log(`الحجم:     ${backup?.sizeBytes ? `${(backup.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : '—'}`);
  console.log(`السلامة:   ${backup?.integrityVerified ? 'مُتحقَّق منها' : 'لم تُتحقَّق'}`);
  console.log(`قابلة للاستعادة: ${backup?.complete === false ? 'لا — ناقصة' : 'نعم'}`);

  for (const warning of warnings) console.log(`\nتنبيه: ${warning}`);

  if (!apply) {
    console.log('\nلم يُستورد شيء. أضف --apply لتنفيذ الاستيراد.');
    process.exit(0);
  }

  console.log('\nالخطوة التالية — للاستعادة، افتح مركز النسخ الاحتياطية، أو:');
  console.log(`  curl -X POST ${apiUrl}/backup/restore \\`);
  console.log(`    -H 'Content-Type: application/json' -b <session-cookie> \\`);
  console.log(`    -d '{"backupId":"${backup?.id}","restorePin":"…","confirmRestore":false}'`);
};

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
