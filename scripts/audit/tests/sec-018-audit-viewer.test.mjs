// Gate 3.1 / 3.2 — the audit screen could not display a single row, and its
// filters were the kind that return a confident wrong answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const ui = readFileSync(join(repoRoot, 'frontend/src/modules/settings/components/AuditLogs.tsx'), 'utf8');
const service = readFileSync(join(repoRoot, 'backend/src/audit/audit.service.ts'), 'utf8');
const controller = readFileSync(join(repoRoot, 'backend/src/audit/audit.controller.ts'), 'utf8');

/**
 * The source with its comments removed.
 *
 * Every negative assertion below would otherwise be matched by the comment
 * documenting the very defect it forbids — the component's own notes quote
 * `log.details`, `log.status === 'SUCCESS'` and the old `Array.isArray` shape
 * verbatim. A guard that can be satisfied by prose is not a guard.
 */
const codeOf = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

test('gate 3.1 the audit screen reads the payload the server actually sends', () => {
  // The endpoint returns { rows, total, limit, offset } and the fetch required an
  // array, so the table was permanently empty with no error — an auditor
  // inspecting a security trail could not distinguish that from "nothing happened".
  const code = codeOf(ui);
  assert.doesNotMatch(
    code,
    /Array\.isArray\(response\.data\) \? response\.data : \[\]/,
    'the response is an object; requiring an array is what emptied the screen',
  );
  assert.match(ui, /const payload = \(response\.data \?\? \{\}\) as Partial<AuditLogsPage>/);
  assert.match(ui, /Array\.isArray\(payload\.rows\) \? payload\.rows : \[\]/);

  // The field is `message` on the wire and `details` in Prisma via @map, so a
  // details column reading `details` was always '-'.
  assert.match(ui, /message: string;/);
  assert.doesNotMatch(codeOf(ui), /log\.details/);
  assert.doesNotMatch(codeOf(ui), /JSON\.parse\(log\./, 'unguarded JSON.parse throws during render');

  // The server lower-cases status, and the comparison was against 'SUCCESS', so
  // every row was painted as a failure — erasing the one distinction the column
  // exists to make.
  assert.match(ui, /status: 'success' \| 'failed';/);
  assert.match(ui, /log\.status === 'success'/);
  assert.doesNotMatch(codeOf(ui), /log\.status === 'SUCCESS'/);
});

test('gate 3.1 action badges match the vocabulary the server emits', () => {
  // Real ids are ITEM_CREATE, REFERENCE_DATA_UPDATE, LOGIN_FAILED,
  // UNLOADING_RULE_UPDATE. Equality against 'CREATE' matched none, so every badge
  // fell through to grey and a destructive action looked like a read.
  assert.doesNotMatch(codeOf(ui), /log\.action === 'CREATE'/);
  assert.match(ui, /const actionTone = \(action: string\)/);
  assert.match(ui, /id\.includes\('DELETE'\)/);
  // The failure verbs are tested before the write verbs, or LOGIN_FAILED and
  // SYSTEM_RESET_FAILURE get painted as ordinary updates.
  const tone = ui.slice(ui.indexOf('const actionTone'));
  assert.ok(
    tone.indexOf("id.includes('DELETE')") < tone.indexOf("id.endsWith('CREATE')"),
    'failure verbs must be classified before write verbs',
  );
});

test('gate 3.2 the filters reach the server, and the page is not the total', () => {
  // Every filter the endpoint supports is now sent, rather than applied to one
  // fetched page — which is what let an auditor conclude there were no
  // LOGIN_FAILED events when the 500th row was simply not loaded.
  for (const key of ['action', 'entityType', 'status', 'from', 'to', 'search', 'offset']) {
    assert.match(ui, new RegExp(key), `${key} must be part of the request`);
  }
  assert.doesNotMatch(
    ui,
    /const filteredLogs = logs\.filter\(/,
    'a second client-side definition of the same query is how the two disagreed',
  );
  // The alias existed to say "the server already filtered this, so this is just the
  // page". Renamed to `pageRows`, which says the same thing without the word `filtered`
  // — an auditor reading `filteredLogs` reasonably assumes a local filter ran.
  assert.match(ui, /const pageRows = logs;/);

  // "X of 50" where 50 was the page size: the number an auditor read as the size
  // of the trail was the size of the window.
  assert.doesNotMatch(ui, /\{logs\.length\} (سجل|سجلات)/);
  assert.match(ui, /\{total\}/);
  assert.match(ui, /totalPages = Math\.max\(1, Math\.ceil\(total \/ PAGE_SIZE\)\)/);
  // Without pagination the trail was a fixed window with no way past it.
  assert.match(ui, /totalPages > 1/);
  // Changing a filter while on page 4 asks for the fourth page of a shorter query.
  assert.match(ui, /const applyFilter = /);
});

test('gate 3.2 the filter options come from the database', () => {
  // Built from the rows on screen, an action that exists but is not in the newest
  // page could not be selected at all: the option was simply missing.
  assert.match(controller, /@Get\('logs\/facets'\)/);
  assert.match(service, /async queryFacets/);
  assert.match(ui, /\/audit\/logs\/facets/);
  assert.doesNotMatch(
    ui,
    /Array\.from\(new Set\(logs\.map/,
    'options derived from the page cannot offer what the page does not contain',
  );
});

test('gate 3.2 search and status had state but no control', () => {
  // Dead code that reads as a feature: the two most useful questions an auditor
  // has — what failed, and search this actor — were unreachable.
  assert.match(ui, /onChange=\{\(e\) => \{ setPage\(1\); setSearchTerm/);
  assert.match(ui, /onChange=\{\(e\) => applyFilter\(setFilterStatus\)/);
  // A date input renders no placeholder, so two of them needed real labels.
  assert.match(ui, /aria-label="من تاريخ"/);
  assert.match(ui, /aria-label="إلى تاريخ"/);
});
