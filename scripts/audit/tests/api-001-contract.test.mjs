import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('official item CRUD routes are registered', () => {
  const controller = read('backend/src/item/item.controller.ts');
  assert.match(controller, /@Controller\('items'\)/);
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /@Get\(\)/);
  assert.match(controller, /@Get\(':publicId'\)/);
  assert.match(controller, /@Put\(':publicId'\)/);
});

test('item DTOs enforce the canonical write contract', () => {
  const dto = read('backend/src/item/dto/item.dto.ts');
  const main = read('backend/src/main.ts');
  assert.match(dto, /class ListItemsQueryDto/);
  assert.match(dto, /class CreateItemDto/);
  assert.match(dto, /class UpdateItemDto/);
  assert.match(main, /whitelist:\s*true/);
  assert.match(main, /forbidNonWhitelisted:\s*true/);
  const updateDto = dto.slice(dto.indexOf('export class UpdateItemDto'));
  assert.doesNotMatch(updateDto, /publicId/);
});

test('item service returns canonical read/write responses', () => {
  const service = read('backend/src/item/item.service.ts');
  assert.match(service, /async getByPublicId\(/);
  assert.match(service, /private responseSelect\(/);
  assert.match(service, /private toApiItem\(/);
  assert.match(service, /select:\s*this\.responseSelect\(\)/);
});

test('frontend uses the official item contract without legacy list fallback', () => {
  const service = read('frontend/src/services/itemsService.ts');
  assert.match(service, /apiClient\.post\('\/items'/);
  assert.match(service, /apiClient\.put\(`\/items\/\$\{encodeURIComponent\(publicId\)\}`/);
  assert.match(service, /Array\.isArray\(response\.data\.data\)/);
  assert.doesNotMatch(service, /Handle legacy array response/);
  assert.match(service, /toWritePayload\(item, false\)/);
});
