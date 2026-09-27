import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { backendUrl, e2ePassword as password, frontendUrl, e2eUsername as username } from './support/runtimeConfig';

/**
 * FC-DEF-001 — the deficit queue, driven through the real screen.
 *
 * The backend half of this feature was finished and accepted while nothing in
 * the UI could open the queue, and the realtime alert had no subscriber. A test
 * that only calls the API cannot see either of those gaps, so this one logs in
 * through the browser, creates an over-issue, and looks for the shortfall in the
 * stocktaking screen.
 */
let browser: Browser;
let page: Page;

const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(init.headers || {}),
    } as Record<string, string>,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

let cookie = '';

beforeAll(async () => {
  const login = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  cookie = String(login.headers.get('set-cookie') || '').split(';')[0];

  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({
    name: 'feed_factory_jwt',
    value: cookie.split('=')[1],
    domain: 'localhost',
    path: '/',
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Poll a predicate inside the page.
 *
 * The predicate is passed to page.evaluate, which serialises it and runs it in
 * the browser, so it must be self-contained: it cannot close over anything from
 * this module. That is why every call site inlines the selector it needs instead
 * of taking a variable.
 */
const waitFor = async (predicate: () => boolean, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

describe('FC-DEF-001 the deficit queue in the UI', () => {
  it('shows an over-issue in the screen and resolves it through the dialog', async () => {
    const suffix = randomUUID().slice(0, 8);
    const publicId = `ui-def-${suffix}`;

    // An item with a small balance, then an issue far larger than it.
    const created = await api('/items', {
      method: 'POST',
      body: JSON.stringify({
        publicId,
        name: `DEF UI ${suffix}`,
        code: `DUI-${suffix}`,
        unit: 'ton',
        category: 'raw',
        minLimit: '0',
        maxLimit: '999999999.999',
      }),
    });
    expect(created.status).toBe(201);

    const inMovement = await api('/transactions', {
      method: 'POST',
      headers: { 'Idempotency-Key': `uid001-${suffix}` },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        itemId: publicId,
        type: 'وارد',
        quantity: '10',
        supplierOrReceiver: 'DEF UI',
      }),
    });
    expect([200, 201]).toContain(inMovement.status);

    const over = await api('/transactions', {
      method: 'POST',
      headers: { 'Idempotency-Key': `uid002-${suffix}` },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        itemId: publicId,
        type: 'صادر',
        quantity: '250',
        supplierOrReceiver: 'DEF UI',
      }),
    });
    expect([200, 201]).toContain(over.status);

    // Now drive the screen. The tab is the only way an operator reaches this.
    await page.goto(`${frontendUrl}/stocktaking`, { waitUntil: 'networkidle2', timeout: 60_000 });
    const tabLoaded = await waitFor(() => Boolean(document.querySelector('[data-testid="deficits-tab"]')));
    expect(tabLoaded, 'the stocktaking screen must expose the deficit queue tab').toBe(true);

    await page.click('[data-testid="deficits-tab"]');
    const queueLoaded = await waitFor(() => Boolean(document.querySelector('[data-testid="stock-deficit-queue"]')));
    expect(queueLoaded, 'the queue must render when the tab is opened').toBe(true);

    // Wait for the row content, not just the container: the container renders
    // immediately with a loading message, so asserting on the shell alone passed
    // while the table was still empty.
    await page.waitForFunction(
      (needle) => document.querySelector('[data-testid="stock-deficit-queue"]')?.textContent?.includes(needle),
      { timeout: 30_000 },
      `DEF UI ${suffix}`,
    ).then(() => undefined).catch(() => {
      throw new Error(`the over-issued item must appear in the queue, "${`DEF UI ${suffix}`}" did not render`);
    });

    // The header summary has to report the outstanding shortfall, otherwise an
    // operator has to read every row to learn that something is wrong.
    const summary = await page.$eval('[data-testid="stock-deficit-queue"]', (el) => el.textContent || '');
    expect(summary, 'the summary must mention the open shortfall').toMatch(/عجز مفتوح/);
    expect(summary, 'the item under shortfall must be named').toContain(`DEF UI ${suffix}`);

    // The write-off path: target THIS item's row. The queue shows every open
    // shortfall, and clicking the first "write off" button in the table would
    // resolve whichever row happened to sort first, not the one this test made.
    const clicked = await page.evaluate((itemId) => {
      const row = document.querySelector(`[data-deficit-item="${itemId}"]`);
      const writeOff = Array.from(row?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent?.includes('إشطبان')) as HTMLButtonElement | undefined;
      if (!writeOff) return false;
      writeOff.click();
      return true;
    }, publicId);
    expect(clicked, 'a resolvable deficit must offer a write-off action').toBe(true);

    const dialog = await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));
    expect(dialog, 'the write-off must ask for a reason').toBe(true);

    await page.type('[role="dialog"] textarea', 'قصير');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[role="dialog"] button') ?? []) as HTMLButtonElement[];
      buttons.find((button) => button.textContent?.includes('تأكيد'))?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const stillOpen = await page.$('[role="dialog"]');
    expect(stillOpen, 'a reason under ten characters must not close the alert').not.toBeNull();

    await page.evaluate(() => {
      const textarea = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, 'Bour goods confirmed lost during the September audit count');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[role="dialog"] button') ?? []) as HTMLButtonElement[];
      buttons.find((button) => button.textContent?.includes('تأكيد'))?.click();
    });
    await waitFor(() => !document.querySelector('[role="dialog"]'));

    // The API is the authority on whether the decision was recorded.
    const settled = await api(`/stock-deficits?itemId=${publicId}&status=WRITTEN_OFF`);
    expect(settled.status).toBe(200);
    const rows = settled.body?.data ?? [];
    expect(rows.length, 'the write-off must be recorded').toBeGreaterThan(0);
    expect(rows[0]?.resolution ?? '').toContain('September audit count');

    await page.screenshot({ path: '.hermes/proof/QA-002/deficit-queue-ui.png', fullPage: false });
  }, 180_000);
});
