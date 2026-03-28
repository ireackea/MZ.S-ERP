import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const frontendUrl = process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:4173';
const backendUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';
const screenshotDir = path.resolve(process.cwd(), 'artifacts', 'phase3');
const downloadDir = path.join(screenshotDir, 'backup-downloads');
const restorePin = '2468';

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

type BackupEntry = {
  id: string;
  fileName: string;
  type: 'full' | 'inventory' | 'config' | 'safety_snapshot';
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
const createdBackupIds = new Set<string>();

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

async function apiRequest<T>(pathname: string, init: RequestInit = {}, cookieHeader = adminSession.cookieHeader): Promise<{ response: Response; data: T }> {
  const response = await fetchWithRetry(`${backendUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      Cookie: cookieHeader,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

async function createManagedPage() {
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  });
  return page;
}

async function openAuthenticatedSettingsPage() {
  const page = await createManagedPage();
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
      const isVisible = element.offsetParent !== null;
      return isVisible && !element.disabled && button.textContent?.includes(expectedText);
    });
    const target = buttons[buttons.length - 1] as HTMLButtonElement | undefined;
    if (!target) return false;
    target.click();
    return true;
  }, text);

  expect(clicked).toBe(true);
}

async function openBackupTabFromSettings(page: Page) {
  await waitForText(page, 'الإعدادات العالمية');
  await clickButtonByText(page, 'النسخ الاحتياطي');
  await waitForText(page, 'لوحة النسخ الاحتياطي والاستعادة');
}

async function setInputValueByLabel(page: Page, labelText: string, value: string | number) {
  const updated = await page.evaluate(
    ({ expectedLabel, nextValue }) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const target = labels.find((label) => label.textContent?.includes(expectedLabel));
      const field = target?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
      if (!field) return false;
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!valueSetter) return false;
      field.focus();
      valueSetter.call(field, String(nextValue));
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { expectedLabel: labelText, nextValue: String(value) },
  );

  expect(updated).toBe(true);
}

async function setSelectValueByLabel(page: Page, labelText: string, value: string | number) {
  const updated = await page.evaluate(
    ({ expectedLabel, nextValue }) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const target = labels.find((label) => label.textContent?.includes(expectedLabel));
      const field = target?.querySelector('select') as HTMLSelectElement | null;
      if (!field) return false;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!valueSetter) return false;
      valueSetter.call(field, String(nextValue));
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { expectedLabel: labelText, nextValue: String(value) },
  );

  expect(updated).toBe(true);
}

async function waitForToast(page: Page, text: string, timeout = 30000) {
  await page.waitForFunction(
    (expectedText) => Array.from(document.querySelectorAll('[data-sonner-toast]')).some((node) => node.textContent?.includes(expectedText)),
    { timeout },
    text,
  );
}

async function assertNoBackupEncodingCorruption(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const token of forbiddenBackupTextTokens) {
    expect(text.includes(token)).toBe(false);
  }
}

beforeAll(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  for (const entry of fs.readdirSync(downloadDir)) {
    fs.rmSync(path.join(downloadDir, entry), { force: true, recursive: true });
  }

  adminSession = await loginByApi();
  browser = await puppeteer.launch({ headless: 'new' });
}, 90000);

afterAll(async () => {
  for (const backupId of createdBackupIds) {
    await apiRequest(`/api/backup/${backupId}`, { method: 'DELETE' }).catch(() => undefined);
  }
  await browser?.close();
}, 90000);

describe('backup dashboard settings flow', () => {
  it('saves schedule settings and executes create, download, restore, and delete actions successfully', async () => {
    const { page, pageErrors } = await openAuthenticatedSettingsPage();

    const backupTabVisible = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('النسخ الاحتياطي'));
    });
    expect(backupTabVisible).toBe(true);
    await openBackupTabFromSettings(page);
    await assertNoBackupEncodingCorruption(page);

    const { response: saveScheduleResponse, data: saveSchedulePayload } = await apiRequest<{ success: boolean; data: { frequency: string; dayOfWeek: number; retentionDays: number; hasRestorePin: boolean } }>('/api/backup/schedule', {
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        frequency: 'weekly',
        hour: 2,
        minute: 0,
        dayOfWeek: 1,
        dayOfMonth: 1,
        retentionDays: 14,
        storageTargets: ['local'],
        encryptionEnabled: true,
        restorePin,
      }),
    });
    expect(saveScheduleResponse.ok).toBe(true);
    expect(saveSchedulePayload.success).toBe(true);
    expect(saveSchedulePayload.data.frequency).toBe('weekly');
    expect(saveSchedulePayload.data.dayOfWeek).toBe(1);
    expect(saveSchedulePayload.data.retentionDays).toBe(14);
    expect(saveSchedulePayload.data.hasRestorePin).toBe(true);
    await page.reload({ waitUntil: 'networkidle2' });
    await openBackupTabFromSettings(page);
    await assertNoBackupEncodingCorruption(page);

    const { response: createConfigResponse, data: createConfigPayload } = await apiRequest<{ success: boolean; data: BackupEntry }>('/api/backup/config', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(createConfigResponse.ok).toBe(true);
    expect(createConfigPayload.success).toBe(true);
    expect(createConfigPayload.data.type).toBe('config');
    createdBackupIds.add(createConfigPayload.data.id);

    const latestConfigBackup = createConfigPayload.data as BackupEntry;
    expect(latestConfigBackup.type).toBe('config');

    const downloadResponse = await fetchWithRetry(`${backendUrl}/api/backup/download/${latestConfigBackup.id}`, {
      method: 'GET',
      headers: {
        Cookie: adminSession.cookieHeader,
      },
    });
    expect(downloadResponse.ok).toBe(true);
    expect(String(downloadResponse.headers.get('x-backup-checksum') || '')).not.toBe('');
    const downloadBytes = Buffer.from(await downloadResponse.arrayBuffer());
    expect(downloadBytes.length).toBeGreaterThan(0);

    const { response: previewResponse, data: previewPayload } = await apiRequest<{ success: boolean; stage: string; data: { restoreToken: string; safetySnapshotId: string } }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({
        backupId: latestConfigBackup.id,
        restorePin,
        confirmRestore: false,
      }),
    });
    expect(previewResponse.ok).toBe(true);
    expect(previewPayload.success).toBe(true);
    expect(previewPayload.stage).toBe('preview');
    expect(String(previewPayload.data?.safetySnapshotId || '')).not.toBe('');
    createdBackupIds.add(previewPayload.data.safetySnapshotId);

    const { response: applyResponse, data: applyPayload } = await apiRequest<{ success: boolean; stage: string }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({
        backupId: latestConfigBackup.id,
        restorePin,
        restoreToken: previewPayload.data.restoreToken,
        confirmRestore: true,
      }),
    });
    expect(applyResponse.ok).toBe(true);
    expect(applyPayload.success).toBe(true);
    expect(applyPayload.stage).toBe('applied');

    const createFullResponse = page.waitForResponse(
      (response) => response.url().includes('/api/backup/full') && response.request().method() === 'POST',
      { timeout: 60000 },
    );
    await clickButtonByText(page, 'إنشاء نسخة كاملة');
    const createFullPayload = await (await createFullResponse).json();
    expect(createFullPayload.success).toBe(true);
    expect(createFullPayload.data.type).toBe('full');
    createdBackupIds.add(createFullPayload.data.id);
    await waitForToast(page, 'تم إنشاء النسخة الاحتياطية بنجاح');

    const { response: createInventoryResponse, data: createInventoryPayload } = await apiRequest<{ success: boolean; data: BackupEntry }>('/api/backup/inventory', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(createInventoryResponse.ok).toBe(true);
    expect(createInventoryPayload.success).toBe(true);
    expect(createInventoryPayload.data.type).toBe('inventory');
    createdBackupIds.add(createInventoryPayload.data.id);

    const { response: deleteResponse, data: deletePayload } = await apiRequest<{ success: boolean; data: { deleted: boolean } }>(`/api/backup/${createInventoryPayload.data.id}`, {
      method: 'DELETE',
    });
    expect(deleteResponse.ok).toBe(true);
    expect(deletePayload.success).toBe(true);
    expect(deletePayload.data.deleted).toBe(true);
    createdBackupIds.delete(createInventoryPayload.data.id);

    await assertNoBackupEncodingCorruption(page);
    expect(pageErrors).toEqual([]);
    await page.close();
  }, 180000);
});