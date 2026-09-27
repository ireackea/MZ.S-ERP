// FC-OPS-002 — the browser download must stay retryable and skippable.
//
// Puppeteer's postinstall pulls ~627MB during `npm ci`, and the CDN that
// serves it fails intermittently. A transient outage was taking the whole build
// down with "All providers failed for chrome", which reports a network problem
// as a build problem.
//
// Two things have to stay true, and neither is visible from the running app:
//   1. the download retries, and the final failure explains the way out
//   2. PUPPETEER_SKIP_CHROME suppresses the download at its actual source — the
//      postinstall hook — and not only the redundant explicit install. Getting
//      this wrong looks like success: the build completes, the skip is honoured
//      by the explicit step, and `npm ci` has quietly downloaded 627MB anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const dockerfile = readFileSync(join(repoRoot, 'backend/Dockerfile'), 'utf8');

test('FC-OPS-002 the chrome download retries before the build gives up', () => {
  assert.match(dockerfile, /PUPPETEER_SKIP_CHROME/, 'the build must offer a documented way to skip the browser');
  assert.match(dockerfile, /for attempt in 1 2 3/, 'a single download attempt is what failed before');
  assert.match(
    dockerfile,
    /PUPPETEER_SKIP_CHROME=true/,
    'the failure message must name the flag that gets a build past the outage',
  );
});

test('FC-OPS-002 the skip flag suppresses the download at its real source', () => {
  // Skipping only `npx puppeteer browsers install chrome` is cosmetic: the
  // postinstall hook inside `npm ci` is what actually pulls the browser.
  assert.match(
    dockerfile,
    /PUPPETEER_SKIP_DOWNLOAD=true/,
    'npm ci pulls chrome via puppeteer postinstall; the skip must reach it',
  );
  assert.match(
    dockerfile,
    /PUPPETEER_SKIP_DOWNLOAD=true[\s\S]{0,120}npm ci/,
    'the skip must be applied to the npm ci invocation',
  );
});

test('FC-OPS-002 the browser cache crosses stages with a COPY, not an in-stage cp', () => {
  // The production stage starts from a bare node image and has no puppeteer
  // cache of its own, so an in-stage `cp -r /root/.cache/puppeteer` always
  // fails. Only COPY --from=builder can carry it.
  assert.match(
    dockerfile,
    /COPY --from=builder[^\n]*\/root\/\.cache\/puppeteer/,
    'the browser cache must be copied from the builder stage',
  );
  assert.doesNotMatch(
    dockerfile,
    /cp -r \/root\/\.cache\/puppeteer/,
    'an in-stage cp cannot reach the builder filesystem',
  );
  // The builder must create the directory even when skipping, or the copy fails.
  assert.match(
    dockerfile,
    /mkdir -p \/root\/\.cache\/puppeteer/,
    'the builder must create the cache dir in the skip branch so the copy still works',
  );
});

test('FC-OPS-002 pdf launch goes through the helper that explains a missing browser', () => {
  const helper = readFileSync(join(repoRoot, 'backend/src/common/pdf-browser.ts'), 'utf8');
  assert.match(helper, /ServiceUnavailableException/);
  assert.match(helper, /PUPPETEER_SKIP_CHROME/, 'the runtime error must name the build flag that caused it');

  // No service may launch a browser directly, or a missing one becomes a 500
  // carrying a puppeteer stack trace instead of a 503 that explains itself.
  const services = [
    'backend/src/report/report.service.ts',
    'backend/src/reports/report.service.ts',
  ];
  for (const rel of services) {
    const source = readFileSync(join(repoRoot, rel), 'utf8');
    assert.doesNotMatch(
      source,
      /puppeteer\.launch\(/,
      `${rel} launches a browser directly; route it through common/pdf-browser.ts`,
    );
    assert.match(source, /launchBrowser\(/, `${rel} must use the shared launcher`);
  }
});
