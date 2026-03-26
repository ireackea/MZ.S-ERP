import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const frontendUrl = process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:4173';
const backendUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';

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

const forbiddenBackupTextTokens = [
  'Backup Dashboard',
  'Safety Snapshot',
  'Restore PIN (2FA)',
  '7778y7', // encoding-check-ignore-line
  '78\u001e',
  '78\u001b',
];

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

async function openAuthenticatedSettingsPage() {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));

  const sessionCookie = adminSession.cookieHeader
    .split('; ')
    .find((entry) => entry.startsWith('feed_factory_jwt='));

  if (!sessionCookie) {
    throw new Error('Missing feed_factory_jwt cookie for authenticated browser page.');
  }

  await page.setCookie({
    name: 'feed_factory_jwt',
    value: sessionCookie.slice('feed_factory_jwt='.length),
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  });

  await page.goto(frontendUrl, { waitUntil: 'networkidle2' });
  await page.evaluate((user) => {
    localStorage.setItem('feed_factory_jwt_user', JSON.stringify(user));
    window.dispatchEvent(new Event('feed_factory_auth_session_changed'));
  }, adminSession.user);
  await page.goto(`${frontendUrl}/settings`, { waitUntil: 'networkidle2' });

  return { page, pageErrors };
}

async function waitForText(page: Page, text: string, timeout = 30000) {
  await page.waitForFunction(
    (expectedText) => document.body.innerText.includes(expectedText),
    { timeout },
    text,
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

async function assertNoBackupEncodingCorruption(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const token of forbiddenBackupTextTokens) {
    expect(text.includes(token)).toBe(false);
  }
}

beforeAll(async () => {
  adminSession = await loginByApi();
  browser = await puppeteer.launch({ headless: 'new' });
}, 90000);

afterAll(async () => {
  await browser?.close();
}, 90000);

describe('settings tabs regression smoke', () => {
  it('opens neighboring settings tabs without runtime crashes', async () => {
    const { page, pageErrors } = await openAuthenticatedSettingsPage();

    await waitForText(page, 'الإعدادات العالمية');

    const tabs: Array<{ button: string; expected: string }> = [
      { button: 'الإعدادات العامة', expected: 'الإعدادات العامة' },
      { button: 'المستخدمون والأدوار', expected: 'إدارة هوية المستخدمين والصلاحيات' },
      { button: 'مصفوفة الصلاحيات', expected: 'مصفوفة الصلاحيات' },
      { button: 'النسخ الاحتياطي', expected: 'لوحة النسخ الاحتياطي والاستعادة' },
      { button: 'إعادة الضبط', expected: 'إعادة ضبط النظام' },
      { button: 'سجلات التدقيق', expected: 'سجل التدقيق الأمني' },
      { button: 'إعدادات الأوفلاين', expected: 'حالة الاتصال' },
      { button: 'قوالب الطباعة', expected: 'قوالب الطباعة' },
      { button: 'الثيم واللغة', expected: 'الثيم واللغة' },
    ];

    for (const tab of tabs) {
      await clickButtonByText(page, tab.button);
      await waitForText(page, tab.expected);
      if (tab.button === 'النسخ الاحتياطي') {
        await assertNoBackupEncodingCorruption(page);
      }
    }

    expect(pageErrors).toEqual([]);
    await page.close();
  }, 180000);
});