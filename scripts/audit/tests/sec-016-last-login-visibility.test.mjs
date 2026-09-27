// F-48 — an administrator triaging a user account had nothing to read.
//
// `email`, `failedAttempts` and `mustChangePassword` were all on the DTO and none
// of them reached the table, and no last-login was recorded anywhere, so a
// dormant account, an account that has never been used, and an account someone
// keeps mistyping into were indistinguishable in the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const iam = readFileSync(join(repoRoot, 'frontend/src/components/UnifiedIAM.tsx'), 'utf8');
const usersService = readFileSync(join(repoRoot, 'backend/src/users/users.service.ts'), 'utf8');
const usersDto = readFileSync(join(repoRoot, 'frontend/src/services/usersService.ts'), 'utf8');

test('F-48 the user table renders the facts needed to triage an account', () => {
  assert.match(iam, /user\.lastLoginAt/, 'the last login must be rendered, not just returned');
  assert.match(iam, /user\.failedAttempts/, 'a failed-attempt count that never renders is not a signal');
  assert.match(iam, /user\.email/, 'the email is the identity an administrator matches against a person');
});

test('F-48 an account that never signed in is distinguishable from a dormant one', () => {
  // A single timestamp cannot express "never", and rendering an empty cell makes
  // the two cases look the same as a missing feature rather than a fact.
  assert.match(
    iam,
    /lastLoginAt\s*\?[\s\S]{0,400}?:\s*\(\s*<span[^>]*>\s*لم يدخل بعد/,
    'the null case needs its own label, or a never-used account reads as dormant',
  );
});

test('F-48 last login is derived from the session table, not stored or invented', () => {
  assert.match(
    usersService,
    /activeSession\.groupBy/,
    'the list must read the session table rather than carry a column every login path has to maintain',
  );
  assert.match(usersService, /_max:\s*\{\s*lastActivityAt/);

  // A hardcoded field would satisfy the UI assertions above while being a lie.
  assert.doesNotMatch(
    usersService,
    /lastLoginAt:\s*new Date\(\)/,
    'a last login that is generated rather than read reports the render time',
  );
  assert.match(usersService, /lastLoginAt,\s*$/m, 'toUserDto must carry the value it was given');
});

test('F-48 the user table headers and cells stay aligned', () => {
  // The checkbox column was headed "تحديث" while no such data column existed, so
  // every header after it named the cell one to its left. Nothing detected it
  // because nothing compared the counts.
  //
  // Scoped to the users table: the file also renders the roles and sessions
  // tables, which have their own column counts and are not what this covers.
  const table = iam.match(/\{\/\* Users Table \*\/[\s\S]*?<\/table>/);
  assert.ok(table, 'the users table must be present');

  const header = table[0].match(/<thead>[\s\S]*?<\/thead>/);
  assert.ok(header, 'the users table must have a header');
  const thCount = (header[0].match(/<th\b/g) || []).length;

  // Select-all checkbox + المستخدم + الدور + الحالة + آخر دخول + آخر تحديث + الإجراءات
  assert.equal(thCount, 7, 'the users table must have one header per column it renders');

  const row = table[0].match(/users\.map\(\(user\)[\s\S]*?<\/tr>/);
  assert.ok(row, 'the users table must render a row per user');
  const tdCount = (row[0].match(/<td\b/g) || []).length;
  assert.equal(
    tdCount,
    thCount,
    'the first data row must have a cell for every header, or a column is titled but never filled',
  );

  for (const match of table[0].match(/colSpan=\{(\d+)\}/g) || []) {
    assert.equal(
      Number(match.match(/\d+/)[0]),
      thCount,
      'the empty/loading row must span every column, or the table is ragged while loading',
    );
  }
});

test('F-48 the DTO type carries the field the endpoint returns', () => {
  assert.match(usersDto, /lastLoginAt\?:\s*string \| null/);
  assert.match(usersDto, /lastLoginAt:\s*row\?\.lastLoginAt \?\? null/);
});
