import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * Named, saved catalogue orders.
 *
 * The behaviour these lock down is the one that was asked for, and the distinction
 * matters more than any of the buttons:
 *
 *   Moving things on screen is free. Nothing is *saved* until an explicit act.
 *
 * So an operator can rearrange the catalogue, add items, import a spreadsheet, and
 * nothing is kept under a name until they press refresh or save under a new one.
 * The failure this prevents is the quiet one: an arrangement that looks saved,
 * disappears on the next refresh, and is only discovered when someone goes looking
 * for an item that has moved.
 *
 * The second thing these prove is that a saved order is *shared*. A second login
 * sees the same order, because an order kept in one browser's memory is an order
 * nobody else has.
 */

const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
};

const login = async () => {
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(result.response.status, 'login failed').toBe(201);
  return String(result.response.headers.get('set-cookie') || '').split(';')[0];
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

const CATEGORY = 'zz-e2e-order-profile';
const created: { profileIds: string[]; publicIds: string[] } = { profileIds: [], publicIds: [] };

const cleanup = async () => {
  if (created.profileIds.length > 0) {
    // Profiles first: the entries cascade from them, and from the items too, but
    // the ids are known here so nothing relies on a wildcard.
    //
    // Deactivating is not optional housekeeping. The seeded profile is the
    // catalogue's only active order, and the partial unique index means the test
    // cannot delete it. So the deletion has to hand the role back, and a run that
    // skipped that step would leave the catalogue showing an order nothing
    // remembers — which is exactly the state the feature exists to prevent.
    psql(
      `UPDATE "ItemOrderProfile" SET "isActive" = false WHERE "id" IN (${created.profileIds
        .map((id) => `'${id}'`)
        .join(',')});`,
    );
    psql(`DELETE FROM "ItemOrderProfile" WHERE "id" IN (${created.profileIds.map((id) => `'${id}'`).join(',')});`);
    created.profileIds.length = 0;

    // Hand the role back to a surviving order, so the catalogue is never left
    // with no active order after a test run.
    //
    // Through the API, with a session, rather than by flipping the column: the
    // endpoint is the only thing that also re-materialises `Item.sortOrder`, and
    // a raw `UPDATE` would leave the column describing an order that is not
    // active. The first version of this called the API with no cookie and got a
    // 401, which is how the catalogue was left with nothing active and the run
    // still looked clean.
    const remaining = psql(`SELECT count(*) FROM "ItemOrderProfile" WHERE "isActive" = true;`);
    if (Number(remaining) === 0) {
      const fallback = psql(
        `SELECT "id" FROM "ItemOrderProfile" ORDER BY "createdAt" ASC LIMIT 1;`,
      );
      if (fallback) {
        const cookie = await login();
        const restored = await request(`/items/order-profiles/${fallback.trim()}/apply`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        });
        if (restored.response.status >= 400) {
          throw new Error(
            `could not restore an active saved order: ${restored.response.status} ${JSON.stringify(restored.body).slice(0, 200)}`,
          );
        }
      }
    }
  }
  if (created.publicIds.length > 0) {
    psql(`DELETE FROM "Item" WHERE "publicId" IN (${created.publicIds.map((id) => `'${id}'`).join(',')});`);
    created.publicIds.length = 0;
  }
  // Any probe left by a run that failed midway, removed by category rather than
  // by a publicId prefix — the import path assigns its own ids, so a prefix is
  // not something these rows can be found by.
  psql(`DELETE FROM "Item" WHERE category = '${CATEGORY}';`);
};

const seed = async (cookie: string, count: number) => {
  const publicIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const publicId = `${CATEGORY}-${randomUUID().slice(0, 8)}`;
    const result = await request('/items', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicId,
        // Named so the alphabetical order is the reverse of the order created.
        name: `صنف ${String.fromCharCode(90 - index)} ${index + 1}`,
        category: CATEGORY,
        unit: 'kg',
      }),
    });
    expect(result.response.status, JSON.stringify(result.body).slice(0, 200)).toBe(201);
    publicIds.push(publicId);
    created.publicIds.push(publicId);
  }
  return publicIds;
};

const liveOrder = async (cookie: string): Promise<string[]> => {
  const list = await request('/items?page=1&limit=1000', { headers: { Cookie: cookie } });
  expect(list.response.status).toBe(200);
  return (data(list.body) as Array<{ publicId: string; category?: string }>)
    .filter((item) => item.category === CATEGORY)
    .map((item) => item.publicId);
};

const profiles = async (cookie: string) => {
  const result = await request('/items/order-profiles', { headers: { Cookie: cookie } });
  expect(result.response.status).toBe(200);
  return data(result.body);
};

afterAll(async () => {
  try {
    await cleanup();
  } catch {
    // A hand-back that fails is worth reporting rather than hiding, because it
    // leaves the catalogue without an active order.
    console.error('saved-order cleanup could not restore an active profile');
  }
});

describe('ITEM-004 named, saved catalogue orders', () => {
  beforeAll(async () => {
    await cleanup();
  });

  it('saving under a name keeps the arrangement and shares it with another session', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const built = await seed(cookie, 6);
    expect(built.length).toBe(6);

    // Name the arrangement as it stands on screen right now.
    const name = `ترتيب ${randomUUID().slice(0, 6)}`;
    const saved = await request('/items/order-profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    expect(saved.response.status, JSON.stringify(saved.body).slice(0, 300)).toBe(201);
    expect(data(saved.body).isActive).toBe(true);
    created.profileIds.push(data(saved.body).id);

    // A saved order covers the entire catalogue, not only the items this test
    // created. Asserting it equalled the probe count was wrong twice over: the
    // real operator's items are in there too, and the number that matters is that
    // it is the whole catalogue.
    const catalogueSize = Number(
      psql('SELECT count(*) FROM "Item";'),
    );
    expect(
      data(saved.body).itemCount,
      'a saved order must cover the whole catalogue, not a page of it',
    ).toBe(catalogueSize);

    // Move things around, the way an operator does with the arrows. Nothing is
    // saved by this, which is the whole contract.
    const reordered = [...built].reverse();
    const applied = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: reordered }),
    });
    expect(applied.response.status).toBe(201);
    expect(await liveOrder(cookie)).toEqual(reordered);

    // The saved order has not moved, and the interface can see the difference.
    const afterMove = await profiles(cookie);
    const mine = afterMove.profiles.find((p: any) => p.id === data(saved.body).id);

    // Naming six items renumbers the other 648 as well, because an order is
    // positional: item 7 is item 7 only because of what is before it. So almost
    // everything legitimately reports as moved. The assertions that matter are
    // that drift is visible at all, and that nothing became unlisted.
    expect(
      mine.drift.moved,
      'a rearrangement must show as drift from the saved order',
    ).toBeGreaterThan(0);
    expect(
      mine.drift.unlisted,
      'reordering names no new items, so nothing may become unlisted',
    ).toBe(0);

    // A different session sees the same saved order and the same active flag. A
    // second login cannot be holding anything the first one sent, so what it sees
    // came from the database.
    const otherCookie = await login();
    const otherView = await profiles(otherCookie);
    const otherMine = otherView.profiles.find((p: any) => p.id === data(saved.body).id);
    expect(otherMine, 'a saved order must be visible to every session').toBeTruthy();
    expect(otherMine.isActive).toBe(true);
    expect(otherView.activeProfileId).toBe(data(saved.body).id);
  }, 300_000);

  it('refresh writes the working order into the saved order, so nothing is lost', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const list = await profiles(cookie);
    const active = list.profiles.find((p: any) => p.isActive);
    expect(active, 'a profile must be active for this test to mean anything').toBeTruthy();

    // An item added after the order was written: the operator's exact situation.
    const probesBefore = (await liveOrder(cookie)).length;
    await seed(cookie, 2);
    expect((await liveOrder(cookie)).length).toBe(probesBefore + 2);

    const beforeRefresh = await profiles(cookie);
    const before = beforeRefresh.profiles.find((p: any) => p.id === active.id);
    expect(
      before.drift.unlisted,
      'items the saved order says nothing about must be reported, not hidden',
    ).toBe(2);

    const refreshed = await request(`/items/order-profiles/${active.id}/refresh`, {
      method: 'POST',
      headers,
    });
    expect(refreshed.response.status, JSON.stringify(refreshed.body).slice(0, 300)).toBe(201);
    // The refresh writes the whole catalogue, the probes included.
    expect(data(refreshed.body).itemCount).toBe(
      Number(psql('SELECT count(*) FROM "Item";')),
    );

    const afterRefresh = await profiles(cookie);
    const mine = afterRefresh.profiles.find((p: any) => p.id === active.id);
    expect(mine.drift.unlisted, 'after a refresh nothing is outside the order').toBe(0);
    expect(mine.drift.moved, 'after a refresh the order matches what is on screen').toBe(0);
  }, 300_000);

  it('applying a saved order puts the catalogue back the way that order says', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const saved = await seed(cookie, 3);
    const name = `ترتيب مُستعاد ${randomUUID().slice(0, 6)}`;
    const created1 = await request('/items/order-profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    expect(created1.response.status).toBe(201);
    const id = data(created1.body).id;
    created.profileIds.push(id);
    const orderAtSave = await liveOrder(cookie);

    // Scatter it.
    const scattered = [...orderAtSave].reverse();
    const applied = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: scattered }),
    });
    expect(applied.response.status).toBe(201);
    expect(await liveOrder(cookie)).toEqual(scattered);

    // A second order to switch between, so "apply" has something to switch from.
    const otherName = `ترتيب بديل ${randomUUID().slice(0, 6)}`;
    const created2 = await request('/items/order-profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: otherName }),
    });
    expect(created2.response.status).toBe(201);
    created.profileIds.push(data(created2.body).id);
    expect(data(created2.body).isActive).toBe(true);

    // Go back to the first one.
    const restore = await request(`/items/order-profiles/${id}/apply`, { method: 'POST', headers });
    expect(restore.response.status, JSON.stringify(restore.body).slice(0, 300)).toBe(201);
    expect(await liveOrder(cookie), 'applying must restore the saved arrangement').toEqual(orderAtSave);

    // And exactly one order is active, which the database enforces but the
    // interface has to reflect.
    const final = await profiles(cookie);
    expect(final.profiles.filter((p: any) => p.isActive).length).toBe(1);
    expect(final.activeProfileId).toBe(id);
  }, 300_000);

  it('refuses a duplicate name, an unknown order, and deleting the active one', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    const name = `ترتيب مكرر ${randomUUID().slice(0, 6)}`;
    const first = await request('/items/order-profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    expect(first.response.status).toBe(201);
    const id = data(first.body).id;
    created.profileIds.push(id);

    // A second order with the same name would leave two rows the operator cannot
    // tell apart, and "apply this one" would be ambiguous.
    const duplicate = await request('/items/order-profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.code).toBe('ITEM_ORDER_PROFILE_NAME_TAKEN');

    const missing = await request('/items/order-profiles/no-such-profile/apply', {
      method: 'POST',
      headers,
    });
    expect(missing.response.status).toBe(404);

    // Deleting the active order would leave the catalogue showing an arrangement
    // that nothing remembers, so it is refused with a reason.
    const removeActive = await request(`/items/order-profiles/${id}`, { method: 'DELETE', headers });
    expect(removeActive.response.status).toBe(409);
    expect(removeActive.body.code).toBe('ITEM_ORDER_PROFILE_ACTIVE');

    // An inactive one is removable.
    const second = await request('/items/order-profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `ترتيب قابل للحذف ${randomUUID().slice(0, 6)}` }),
    });
    expect(second.response.status).toBe(201);
    const secondId = data(second.body).id;
    created.profileIds.push(secondId);
    // `second` is now the active one, so switch away before deleting it.
    await request(`/items/order-profiles/${id}/apply`, { method: 'POST', headers });
    const removed = await request(`/items/order-profiles/${secondId}`, { method: 'DELETE', headers });
    expect(removed.response.status, JSON.stringify(removed.body).slice(0, 200)).toBe(200);
  }, 300_000);

  it('writes a record of what it did, attributed to the person who did it', async () => {
    const cookie = await login();
    const names = [
      'ITEM_ORDER_PROFILE_SAVED',
      'ITEM_ORDER_PROFILE_APPLIED',
      'ITEM_ORDER_PROFILE_REFRESHED',
    ];

    const rows = psql(
      `SELECT DISTINCT action || '|' || "actorUsername" || '|' || "targetResource" ` +
      `FROM audit_logs WHERE action IN (${names.map((n) => `'${n}'`).join(',')});`,
    );

    expect(rows, 'each saved-order action must leave a record').toContain('ITEM_ORDER_PROFILE_SAVED');
    for (const name of names) {
      expect(rows, `${name} left no audit row`).toContain(name);
    }
    // A record with a null actor is the exact defect the reset had: the action
    // happened and nobody can see who did it.
    expect(rows).not.toContain('|system|');
    expect(rows).toContain(username);
  }, 120_000);
});
