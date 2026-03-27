// ENTERPRISE FIX: Phase 3 Final Visual Proof & Cleanup - Archive Only - 2026-03-27
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const frontendUrl = process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:4173';
const backendUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';
const screenshotDir = path.resolve(process.cwd(), 'artifacts', 'phase3', 'screenshots-after-cleanup');

type Session = {
  cookieHeader: string;
  user: {
    id: string;
    username: string;
    role: string;
    permissions?: string[];
    name?: string;
  };
};

let browser: Browser;
let adminSession: Session;

const extractCookies = (response: Response) => {
  const raw = (response.headers as any).getSetCookie?.() as string[] | undefined;
  if (raw && raw.length) return raw;
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
};

const toCookieHeader = (setCookieHeaders: string[]) =>
  setCookieHeaders
    .map((entry) => entry.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(input: string, init: RequestInit, retries = 8, delayMs = 1500): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(input, init);
    lastResponse = response;
    if (response.status !== 429) {
      return response;
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  return lastResponse as Response;
}

async function loginByApi(nextUsername = username, nextPassword = password): Promise<Session> {
  const response = await fetchWithRetry(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: nextUsername, password: nextPassword }),
  });

  const payload = await response.json();
  expect(response.status).toBe(201);
  expect(payload?.user?.username).toBeTruthy();

  const cookieHeader = toCookieHeader(extractCookies(response));
  expect(cookieHeader).toContain('feed_factory_jwt=');

  return {
    cookieHeader,
    user: payload.user,
  };
}

async function openAuthenticatedPage(targetPath: string) {
  const page = await browser.newPage();
  const sessionCookie = adminSession.cookieHeader
    .split('; ')
    .find((entry) => entry.startsWith('feed_factory_jwt='));

  if (!sessionCookie) {
    throw new Error('Missing feed_factory_jwt cookie for authenticated browser page.');
  }

  await page.setViewport({ width: 1440, height: 2200 });
  await page.setCookie({
    name: 'feed_factory_jwt',
    value: sessionCookie.slice('feed_factory_jwt='.length),
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  });

  await page.goto(frontendUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((user) => {
    localStorage.setItem('feed_factory_jwt_user', JSON.stringify(user));
    window.dispatchEvent(new Event('feed_factory_auth_session_changed'));
  }, adminSession.user);
  await page.goto(`${frontendUrl}${targetPath}`, { waitUntil: 'networkidle2', timeout: 60000 });
  return page;
}

async function navigateToPath(page: Page, targetPath: string) {
  await page.goto(`${frontendUrl}${targetPath}`, { waitUntil: 'networkidle2', timeout: 60000 });
}

async function waitForText(page: Page, text: string, timeout = 60000) {
  await page.waitForFunction(
    (expectedText) => document.body.innerText.includes(expectedText),
    { timeout },
    text,
  );
}

async function waitForVisibleText(page: Page, text: string, timeout = 60000) {
  await page.waitForFunction(
    (expectedText) => {
      const elements = Array.from(document.querySelectorAll('*')) as HTMLElement[];
      return elements.some((element) => element.offsetParent !== null && element.innerText?.includes(expectedText));
    },
    { timeout },
    text,
  );
}

async function waitForTextToDisappear(page: Page, text: string, timeout = 60000) {
  await page.waitForFunction(
    (expectedText) => !document.body.innerText.includes(expectedText),
    { timeout },
    text,
  );
}

async function waitForPath(page: Page, expectedPath: string, timeout = 60000) {
  await page.waitForFunction(
    (pathName) => window.location.pathname === pathName,
    { timeout },
    expectedPath,
  );
}

async function clickButtonByText(page: Page, text: string) {
  const clicked = await page.evaluate((expectedText) => {
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {
      const element = button as HTMLButtonElement;
      return element.offsetParent !== null && !element.disabled && button.textContent?.includes(expectedText);
    });

    const target = buttons[buttons.length - 1] as HTMLButtonElement | undefined;
    if (!target) return false;
    target.click();
    return true;
  }, text);

  expect(clicked).toBe(true);
}

async function clearVisibleToasts(page: Page) {
  await delay(750);

  await page.evaluate(() => {
    const toastRoots = Array.from(document.querySelectorAll('[data-sonner-toast]'));
    for (const toast of toastRoots) {
      const closeButton = toast.querySelector('button') as HTMLButtonElement | null;
      if (closeButton && !closeButton.disabled) {
        closeButton.click();
      }
    }
  });

  await delay(500);
}

async function captureSettingsAllTabs(page: Page) {
  await waitForPath(page, '/settings');
  await delay(2500);
  await clearVisibleToasts(page);
  await page.screenshot({ path: path.join(screenshotDir, 'settings-all-tabs.png'), fullPage: true });
}

beforeAll(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  adminSession = await loginByApi();
  browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1440, height: 2200 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}, 90000);

afterAll(async () => {
  await browser?.close();
}, 90000);

describe('phase 3 visual proof after cleanup', () => {
  it('captures dashboard, reports, settings, backup, and items screenshots', async () => {
    console.log('[phase3-visual-proof] dashboard');
    const appPage = await openAuthenticatedPage('/');
    await waitForPath(appPage, '/');
    await delay(1500);
    await clearVisibleToasts(appPage);
    await appPage.screenshot({ path: path.join(screenshotDir, 'dashboard.png'), fullPage: true });

    console.log('[phase3-visual-proof] reports');
    await navigateToPath(appPage, '/reports');
    await waitForPath(appPage, '/reports');
    await delay(1500);
    await clearVisibleToasts(appPage);
    await appPage.screenshot({ path: path.join(screenshotDir, 'reports.png'), fullPage: true });

    console.log('[phase3-visual-proof] settings');
    await navigateToPath(appPage, '/settings');
    await captureSettingsAllTabs(appPage);

    console.log('[phase3-visual-proof] backup');
    await navigateToPath(appPage, '/backup');
    await waitForPath(appPage, '/backup');
    await delay(1500);
    await clearVisibleToasts(appPage);
    await appPage.screenshot({ path: path.join(screenshotDir, 'backup.png'), fullPage: true });

    console.log('[phase3-visual-proof] items');
    await navigateToPath(appPage, '/items');
    await waitForPath(appPage, '/items');
    await waitForVisibleText(appPage, 'إدارة الأصناف');
    await waitForTextToDisappear(appPage, 'جاري التحميل...');
    await waitForTextToDisappear(appPage, 'مرحبا بعودتك');
    await delay(1000);
    await clearVisibleToasts(appPage);
    await appPage.screenshot({ path: path.join(screenshotDir, 'items.png'), fullPage: true });

    await appPage.close();
  }, 180000);
});