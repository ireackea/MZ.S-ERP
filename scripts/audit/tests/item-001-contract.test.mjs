// FC-ITEM-001 — Attachment filename and storage integrity.
// Fails if a client-supplied name can become a stored path, if the disk name and
// the persisted name can diverge, or if a failed DB write leaks a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const controller = read('backend/src/item/item.controller.ts');
const service = read('backend/src/item/item.service.ts');
const safety = read('backend/src/item/attachment-safety.ts');

test('the original filename is never used to build a stored path', () => {
  // The old bug: `${publicId}-${Date.now()}-${file.originalname}`.
  const svc = stripComments(service);
  assert.ok(
    !/\$\{[^}]*originalname[^}]*\}/.test(svc),
    'service still interpolates the client filename into a path',
  );
  assert.ok(
    !/\$\{[^}]*originalname[^}]*\}/.test(stripComments(controller)),
    'controller still interpolates the client filename into a path',
  );
  // Serving must go through the traversal-safe resolver.
  assert.match(service, /resolveStoredPath\(/);
  assert.match(safety, /export const resolveStoredPath/);
});

test('the generated name is the single identity returned and persisted', () => {
  assert.match(service, /const storedName = file\?\.filename \|\| value\.storedName/,
    'the persisted name must be the generated one');
  assert.match(service, /fileName: storedName/,
    'the response must return the generated name as the identity');
  assert.match(service, /const fileUrl = `\/items\/attachments\/\$\{encodeURIComponent\(storedName\)\}`/,
    'the stored URL must point at the guarded download route, not an unmounted static path');
  // The display name is kept separately and labelled as such.
  assert.match(service, /name: value\.displayName/);
  assert.match(service, /originalName: value\.displayName/);
  assert.match(safety, /sanitizeDisplayName/);
});

test('size, type and extension are all validated', () => {
  assert.match(safety, /export const LIMITS/);
  assert.match(safety, /size > limit/, 'the size limit must be enforced');
  assert.match(safety, /export const resolveExtension/);
  assert.match(safety, /does not match the declared type/,
    'extension/type mismatch must be rejected');
  assert.match(safety, /export const isImageMime/);
  assert.match(safety, /export const isAllowedDocumentMime/);
  // The image route must not accept a bare image/* prefix any more.
  assert.ok(
    !/mimetype\.startsWith\('image\/'\)/.test(stripComments(controller)),
    'the image route still trusts any image/* mimetype',
  );
  // The file route must apply a filter rather than accepting anything.
  const fileRoute = controller.slice(controller.indexOf("upload-file"));
  assert.match(fileRoute, /fileFilter/);
  assert.match(fileRoute, /isAllowedDocumentMime/);
});

test('the upload is cleaned up when the database write fails', () => {
  assert.match(service, /try \{[\s\S]*?prisma\.item\.update[\s\S]*?\} catch \(error\) \{[\s\S]*?discardUploadedFile/,
    'a failed item update must remove the uploaded file');
  assert.match(service, /private async discardUploadedFile/);
  // And when the item does not exist in the first place.
  const notFound = service.slice(service.indexOf("if (!item)"), service.indexOf('const built ='));
  assert.match(notFound, /discardUploadedFile/);
});

test('downloads are served with a safe disposition and inferred type', () => {
  assert.match(service, /Content-Disposition.*attachment/,
    'attachments must not be served inline');
  assert.match(service, /X-Content-Type-Options.*nosniff/);
  assert.match(service, /Content-Type.*mimeForExtension/,
    'the content type must come from the stored extension, not client input');
  assert.match(controller, /@Get\('attachments\/:storedName'\)/);
  assert.match(controller, /@Permissions\('items\.view'\)/,
    'the attachment route must be guarded');
});

test('the safety module is the single place these rules live', () => {
  for (const symbol of [
    'buildAttachmentName',
    'resolveExtension',
    'resolveStoredPath',
    'sanitizeDisplayName',
    'sniffImageSignature',
    'LIMITS',
  ]) {
    assert.ok(safety.includes(symbol), `attachment-safety.ts is missing ${symbol}`);
  }
  // The controller and service must import rather than re-implement.
  assert.match(controller, /from '\.\/attachment-safety'/);
  assert.match(service, /from '\.\/attachment-safety'/);
});

test('audit records the stored identity for every attachment write', () => {
  assert.match(service, /ITEM_UPDATE/);
  const audit = service.slice(service.indexOf('ITEM_UPDATE'));
  assert.match(audit, /storedName/, 'the audit row must carry the generated name');
});
