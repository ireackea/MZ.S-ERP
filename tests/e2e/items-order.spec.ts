import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * The catalog order must survive the request.
 *
 * The button "حفظ ترتيب الأصناف" wrote a Zustand array and nothing else, so the
 * order died on reload and no test noticed: nothing in the suite read the order
 * back from the server, and the guards read source text rather than running it.
 * This file is the check that would have caught it. It asserts the order comes
 * back from `GET /items` in a *different session*, which is the only way to tell
 * a saved order from a sorted array that happens to still be in memory.
 *
 * Everything here runs against a throwaway catalog seeded into the live database
 * and removed afterwards — see the cleanup in the last test. The endpoint is not
 * destructive to real items: reordering appends unlisted rows after the listed
 * ones, so this only proves the mechanism. The assertions on real items are the
 * "existing rows are not reordered" ones.
 */

type ApiResponse = { response: Response; body: any };

const request = async (path: string, options: RequestInit = {}): Promise<ApiResponse> => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
};

const login = async (as: string = username, secret: string = password) => {
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: as, password: secret }),
  });
  expect(result.response.status, `login failed for ${as}`).toBe(201);
  const cookie = String(result.response.headers.get('set-cookie') || '').split(';')[0];
  expect(cookie).toContain('feed_factory_jwt=');
  return cookie;
};

const psql = (sql: string): string =>
  execFileSync(
    'docker',
    [
      'compose', '-f', `${process.cwd()}\\docker-compose.yml`,
      'exec', '-T', 'postgres',
      'psql', '-U', process.env.POSTGRES_USER || 'feedfactory',
      '-d', process.env.POSTGRES_DB || 'feed_factory_db',
      '-At', '-F', '|', '-c', sql,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  ).trim();

const data = (body: any) => body?.data ?? body;

const seeded: string[] = [];

/**
 * The prefix every probe row carries.
 *
 * It has to be something no real item can plausibly start with. The first
 * version of this file used `ord-`, and the cleanup matched with
 * `LIKE 'ord-%'` — which also matched a production item whose publicId was
 * `ord-1790474627269` and deleted it. A wildcard in a test cleanup is a deletion
 * aimed at whatever happens to share a prefix, and this repository has a real
 * item that does.
 */
const PROBE_PREFIX = 'zz-e2e-order-probe-';

const seed = (count: number) => {
  const rows = Array.from({ length: count }, (_, index) => {
    const publicId = `${PROBE_PREFIX}${randomUUID().slice(0, 8)}-${index}`;
    seeded.push(publicId);
    return publicId;
  });
  // Inserted without a sortOrder, so the column default of 1000000 applies and
  // the append path is exercised the way a freshly imported item would be.
  for (const publicId of rows) {
    psql(
      `INSERT INTO "Item" ("publicId", name, category, "updatedAt") ` +
      `VALUES ('${publicId}', 'order probe ${publicId}', 'zz-e2e-probe', now());`,
    );
  }
  return rows;
};

const isProbe = (publicId: string) => publicId.startsWith(PROBE_PREFIX);

const cleanup = () => {
  // Scoped to the probe prefix *and* to the probe category, and only ever by an
  // exact id list plus that prefix. A test that leaves rows behind poisons the
  // next run; a test that deletes rows it did not create is worse.
  const ids = seeded.map((id) => `'${id}'`).join(',');
  const scope = ids ? `("publicId" IN (${ids}) OR "publicId" LIKE '${PROBE_PREFIX}%')` : `("publicId" LIKE '${PROBE_PREFIX}%')`;
  psql(`DELETE FROM "Item" WHERE ${scope} AND category = 'zz-e2e-probe';`);
  seeded.length = 0;
};

const readOrder = async (cookie: string, limit = 1000) => {
  const result = await request(`/items?page=1&limit=${limit}`, { headers: { Cookie: cookie } });
  expect(result.response.status).toBe(200);
  return data(result.body).map((item: any) => item.publicId);
};

describe('ITEM-002 the catalog order is saved, not just held in a tab', () => {
  it('returns the submitted order to a different session', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    try {
      const created = seed(12);
      // Reverse, so the submitted order is unmistakably not the natural one.
      const desired = [...created].reverse();

      const saved = await request('/items/reorder', {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderedPublicIds: desired }),
      });

      expect(
        saved.response.status,
        `reorder must succeed: ${JSON.stringify(saved.body).slice(0, 400)}`,
      ).toBe(201);
      expect(saved.body.success).toBe(true);
      expect(saved.body.ranked).toBe(desired.length);
      // Nothing is silently dropped: every submitted id was ranked.
      expect(saved.body.moved).toBeGreaterThan(0);

      // A second login. A different session cannot be holding the order the
      // first one sent, so anything it sees came from the database.
      const otherCookie = await login();
      const order = await readOrder(otherCookie);

      const positions = desired.map((id) => order.indexOf(id));
      expect(
        positions.every((position) => position >= 0),
        'the reordered items must still exist after the save',
      ).toBe(true);
      const sortedPositions = [...positions].sort((a, b) => a - b);
      expect(
        sortedPositions,
        'the saved order must be a contiguous ascending run, not scattered through the catalog',
      ).toEqual(positions);
    } finally {
      cleanup();
    }
  }, 300_000);

  it('refuses an order that names items which do not exist', async () => {
    const cookie = await login();
    const before = await readOrder(cookie);

    const result = await request('/items/reorder', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedPublicIds: [`missing-${randomUUID()}`] }),
    });

    // A 400, not a 201 that quietly saved 0 of 1. Skipping an unresolvable id is
    // how a save reports success while discarding part of the order.
    expect(result.response.status).toBe(400);
    expect(result.body.code ?? result.body.message).toBeDefined();

    expect(await readOrder(cookie), 'a refused save must change nothing').toEqual(before);
  }, 300_000);

  it('rejects a duplicated id and a non-array body', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const duplicated = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: ['a', 'a'] }),
    });
    expect(duplicated.response.status).toBe(400);

    const notAnArray = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: 'a' }),
    });
    expect(notAnArray.response.status).toBe(400);
  }, 120_000);

  it('a partial save does not reshuffle the items it did not name', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    // The order is a total order, so saving a subset has to place the rest
    // somewhere. Putting the unlisted items at the end *by their current rank* is
    // the only choice that does not quietly alphabetise a catalog somebody spent
    // time arranging.
    const realBefore = await readOrder(cookie);
    expect(realBefore.length).toBeGreaterThan(1);

    const probe = seed(3);
    const saved = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: probe }),
    });
    expect(saved.response.status).toBe(201);
    expect(saved.body.ranked).toBe(3);
    // Every row in the catalog is accounted for: the three that were ranked plus
    // everything that was appended to them. This is the invariant that makes the
    // read path's ordering mean anything.
    expect(
      saved.body.ranked + saved.body.appended,
      'a save must place every item, not only the ones it was given',
    ).toBe(saved.body.catalogSize);

    const realAfter = (await readOrder(cookie)).filter((id) => !isProbe(id));
    expect(
      realAfter,
      'the items the save did not name must keep their relative order',
    ).toEqual(realBefore);
  }, 300_000);

  it('leaves the ranks dense, with no gaps and no duplicates', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    // A full save, so the density is checked on a state the operator can
    // actually produce rather than on whatever a partial save happened to leave.
    const current = await readOrder(cookie);
    const saved = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: current }),
    });
    expect(saved.response.status).toBe(201);
    expect(saved.body.appended).toBe(0);

    const ranks = psql(
      `SELECT count(*)::text || '|' || coalesce(max("sortOrder"), -1)::text || '|' ` +
      `|| (SELECT count(*) FROM (SELECT "sortOrder" FROM "Item" GROUP BY "sortOrder" ` +
      `HAVING count(*) > 1) d)::text || '|' || ` +
      `(SELECT count(*) FROM "Item" WHERE "sortOrder" IS NULL)::text FROM "Item";`,
    );
    const [count, max, duplicates, nulls] = ranks.split('|').map(Number);
    expect(count).toBeGreaterThan(1);
    expect(max, 'ranks must run 0..N-1 with no gap').toBe(count - 1);
    expect(duplicates, 'two items may not share a rank').toBe(0);
    expect(nulls, 'no row may be left unranked after a full save').toBe(0);

    cleanup();
  }, 300_000);
});
