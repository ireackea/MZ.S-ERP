// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer, { type Browser, type HTTPResponse, type Page } from 'puppeteer';

const frontendUrl = process.env.E2E_FRONTEND_URL || 'http://127.0.0.1:4173';
const backendUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';
const screenshotDir = path.resolve(process.cwd(), 'artifacts', 'phase3');
const downloadDir = path.join(screenshotDir, 'downloads');

const tempRoleName = `Phase3RestrictedRole_${Date.now()}`;
const tempUsername = `phase3.restricted.${Date.now()}`;
const tempPassword = 'SecurePassword2026!';
const queuedUsername = `phase3.queued.${Date.now()}`;
const reportItemPublicId = `phase3-report-item-${Date.now()}`;
const reportItemCode = `PH3-${Date.now()}`;

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

type RoleDto = {
  id: string;
  name: string;
  permissionsList?: string[];
};

type UserDto = {
  id: string;
  username: string;
};

let browser: Browser;
let tempRoleId: string | null = null;
let tempUserId: string | null = null;
let adminSession: Session;

const ensureArtifactsDir = () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  for (const entry of fs.readdirSync(downloadDir)) {
    fs.rmSync(path.join(downloadDir, entry), { force: true, recursive: true });
  }
};

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

async function fetchWithRetry(input: string, init: RequestInit, retries = 4, delayMs = 1500): Promise<Response> {
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

async function apiRequest<T>(pathname: string, init: RequestInit, cookieHeader: string): Promise<{ response: Response; data: T }> {
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

async function openAuthenticatedPage(session: Session, targetPath = '/') {
  const page = await createManagedPage();
  const sessionCookie = session.cookieHeader
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
  }, session.user);
  await page.goto(`${frontendUrl}${targetPath}`, { waitUntil: 'networkidle2' });

  return page;
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
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((button) => button.textContent?.includes(expectedText));
    if (!target) return false;
    (target as HTMLButtonElement).click();
    return true;
  }, text);

  expect(clicked).toBe(true);
}

async function waitForToast(page: Page, text: string, timeout = 30000) {
  await page.waitForFunction(
    (expectedText) => Array.from(document.querySelectorAll('[data-sonner-toast]')).some((node) => node.textContent?.includes(expectedText)),
    { timeout },
    text,
  );
}

async function waitForDownloadedFile(trigger: () => Promise<void>, extension: '.pdf' | '.xlsx') {
  const before = new Set(fs.readdirSync(downloadDir));
  await trigger();

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const files = fs.readdirSync(downloadDir);
    const candidate = files.find((file) => file.endsWith(extension) && !before.has(file));
    if (candidate) {
      const fullPath = path.join(downloadDir, candidate);
      if (!fs.existsSync(`${fullPath}.crdownload`)) {
        const stats = fs.statSync(fullPath);
        expect(stats.size).toBeGreaterThan(0);
        return fullPath;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${extension} download.`);
}

async function getQueueSize(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('FeedFactoryMutationDB', 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('mutationQueue')) {
          database.createObjectStore('mutationQueue', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });

    return await new Promise<number>((resolve, reject) => {
      const transaction = db.transaction('mutationQueue', 'readonly');
      const store = transaction.objectStore('mutationQueue');
      const countRequest = store.count();
      countRequest.onerror = () => reject(countRequest.error);
      countRequest.onsuccess = () => resolve(countRequest.result);
    });
  });
}

async function enqueueMutation(page: Page, payload: Record<string, unknown>) {
  await page.evaluate(async (taskPayload) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('FeedFactoryMutationDB', 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('mutationQueue')) {
          database.createObjectStore('mutationQueue', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('mutationQueue', 'readwrite');
      const store = transaction.objectStore('mutationQueue');
      const request = store.put({
        id: crypto.randomUUID(),
        url: '/users',
        method: 'POST',
        body: taskPayload,
        timestamp: Date.now(),
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }, payload);
}

async function listUsersBySearch(cookieHeader: string, search: string) {
  const result = await apiRequest<{ data: UserDto[] }>(`/api/users?search=${encodeURIComponent(search)}&limit=50`, { method: 'GET' }, cookieHeader);
  expect(result.response.ok).toBe(true);
  return result.data.data || [];
}

async function waitForApiResponse(page: Page, matcher: (response: HTTPResponse) => boolean, trigger: () => Promise<void>) {
  const responsePromise = page.waitForResponse(matcher);
  await trigger();
  return responsePromise;
}

describe('full system production flow', () => {
  beforeAll(async () => {
    ensureArtifactsDir();
    adminSession = await loginByApi();
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1440, height: 1024 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }, 120000);

  afterAll(async () => {
    if (adminSession?.cookieHeader && tempUserId) {
      await apiRequest(`/api/users/${tempUserId}`, { method: 'DELETE' }, adminSession.cookieHeader).catch(() => null);
    }

    if (browser) {
      await browser.close();
    }
  }, 120000);

  it('logs in, validates metrics, captures dashboard and runs offline sync path', async () => {
    const adminPage = await openAuthenticatedPage(adminSession, '/');

    await waitForText(adminPage, 'لوحة التحكم');
    await adminPage.screenshot({ path: path.join(screenshotDir, 'dashboard.png'), fullPage: true });

    const metricsResponse = await fetch(`${backendUrl}/metrics`);
    const metricsText = await metricsResponse.text();
    expect(metricsResponse.ok).toBe(true);
    expect(metricsText).toContain('http_requests_total');
    expect(metricsText).toContain('process_uptime_seconds');
    expect(metricsText).toContain('http_requests_by_status_total');
    expect(metricsText).toContain('http_requests_by_route_total');

    const rolesResult = await apiRequest<RoleDto[]>('/api/users/roles', { method: 'GET' }, adminSession.cookieHeader);
    expect(rolesResult.response.ok).toBe(true);
    const viewerRole = rolesResult.data.find((role) => role.name.toLowerCase() !== 'superadmin');
    expect(viewerRole?.id).toBeTruthy();

    const createdUser = await apiRequest<UserDto>('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: `phase3.offline.${Date.now()}`,
        password: tempPassword,
        roleId: viewerRole?.id,
        firstName: 'Offline',
        lastName: 'Queue',
        isActive: true,
      }),
    }, adminSession.cookieHeader);
    expect(createdUser.response.ok).toBe(true);

    await adminPage.setOfflineMode(true);
    await adminPage.evaluate(() => window.dispatchEvent(new Event('offline')));
    await waitForText(adminPage, 'أوفلاين');

    await enqueueMutation(adminPage, {
      username: queuedUsername,
      password: 'SecurePassword2026!',
      roleId: viewerRole?.id,
      firstName: 'Queued',
      lastName: 'User',
      isActive: true,
    });

    const queuedTasksWhileOffline = await getQueueSize(adminPage);
    expect(queuedTasksWhileOffline).toBeGreaterThan(0);

    await adminPage.setOfflineMode(false);
    await adminPage.evaluate(() => window.dispatchEvent(new Event('online')));
    await adminPage.waitForFunction(
      async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('FeedFactoryMutationDB', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        return await new Promise<boolean>((resolve, reject) => {
          const transaction = db.transaction('mutationQueue', 'readonly');
          const store = transaction.objectStore('mutationQueue');
          const countRequest = store.count();
          countRequest.onerror = () => reject(countRequest.error);
          countRequest.onsuccess = () => resolve(countRequest.result === 0);
        });
      },
      { timeout: 30000 },
    );

    const queuedUsers = await listUsersBySearch(adminSession.cookieHeader, queuedUsername);
    expect(queuedUsers.some((user) => user.username === queuedUsername)).toBe(true);
    const queuedUser = queuedUsers.find((user) => user.username === queuedUsername);
    if (queuedUser) {
      await apiRequest(`/api/users/${queuedUser.id}`, { method: 'DELETE' }, adminSession.cookieHeader).catch(() => null);
    }

    await apiRequest(`/api/users/${createdUser.data.id}`, { method: 'DELETE' }, adminSession.cookieHeader).catch(() => null);
    await adminPage.close();
  }, 120000);

  it('exports reports to Excel and PDF and captures reports screenshot', async () => {
    const seededItem = await apiRequest<{ data?: unknown }>('/api/items/sync', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          {
            publicId: reportItemPublicId,
            name: 'Phase 3 Export Item',
            code: reportItemCode,
            unit: 'kg',
            category: 'Phase3',
            currentStock: 25,
            minLimit: 5,
            maxLimit: 100,
            orderLimit: 10,
            description: 'Temporary export seed for Phase 3 E2E',
          },
        ],
      }),
    }, adminSession.cookieHeader);
    expect(seededItem.response.ok).toBe(true);

    const adminPage = await openAuthenticatedPage(adminSession, '/reports');
    await waitForText(adminPage, 'التقارير');
    await adminPage.select('select', 'inventory');
    await waitForText(adminPage, 'Phase 3 Export Item');
    await adminPage.screenshot({ path: path.join(screenshotDir, 'reports.png'), fullPage: true });

    await clickButtonByText(adminPage, 'Excel');
    await waitForToast(adminPage, 'تم تصدير التقرير إلى Excel بنجاح.');

    const pdfResponse = await waitForApiResponse(
      adminPage,
      (response) => response.url().includes('/api/reports/print') && response.request().method() === 'POST',
      () => clickButtonByText(adminPage, 'PDF'),
    );
    expect(pdfResponse.ok()).toBe(true);
    await waitForToast(adminPage, 'تم تصدير التقرير إلى PDF بنجاح.');
    await adminPage.close();
    await apiRequest('/api/items/delete', {
      method: 'POST',
      body: JSON.stringify({ publicIds: [reportItemPublicId] }),
    }, adminSession.cookieHeader).catch(() => null);
  }, 120000);

  it('validates settings RBAC with a restricted account and captures settings screenshot', async () => {
    const roleResult = await apiRequest<RoleDto>('/api/users/roles', {
      method: 'POST',
      body: JSON.stringify({
        name: tempRoleName,
        description: 'Phase 3 restricted RBAC role',
        color: '#1d4ed8',
        permissions: ['settings.view', 'settings.view.general'],
      }),
    }, adminSession.cookieHeader);
    expect(roleResult.response.ok).toBe(true);
    tempRoleId = roleResult.data.id;

    const userResult = await apiRequest<UserDto>('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: tempUsername,
        password: tempPassword,
        roleId: tempRoleId,
        firstName: 'Phase',
        lastName: 'Restricted',
        isActive: true,
      }),
    }, adminSession.cookieHeader);
    expect(userResult.response.ok).toBe(true);
    tempUserId = userResult.data.id;

    const restrictedSession = await loginByApi(tempUsername, tempPassword);
    const restrictedPage = await openAuthenticatedPage(restrictedSession, '/settings');
    await waitForText(restrictedPage, 'الإعدادات العالمية');
    await restrictedPage.screenshot({ path: path.join(screenshotDir, 'settings.png'), fullPage: true });

    const settingsText = await restrictedPage.evaluate(() => document.body.innerText);
    expect(settingsText).toContain('الإعدادات العامة');
    expect(settingsText).not.toContain('إعادة الضبط');
    expect(settingsText).not.toContain('المستخدمون والأدوار');
    await restrictedPage.close();
  }, 120000);

  it('checks system reset confirmation rejection without destructive execution', async () => {
    const adminPage = await openAuthenticatedPage(adminSession, '/settings');
    let resetApiCalled = false;
    adminPage.on('request', (request) => {
      if (request.url().includes('/api/admin/reset-system')) {
        resetApiCalled = true;
      }
    });

    await clickButtonByText(adminPage, 'إعادة الضبط');
    await waitForText(adminPage, 'إعادة ضبط النظام');
    await adminPage.click('input[placeholder="CONFIRM_SYSTEM_RESET_2026"]', { clickCount: 3 });
    await adminPage.type('input[placeholder="CONFIRM_SYSTEM_RESET_2026"]', 'WRONG_CONFIRMATION');
    await adminPage.click('button[type="submit"]');
    await waitForText(adminPage, 'رمز التأكيد غير صحيح');
    expect(resetApiCalled).toBe(false);
    await adminPage.close();
  }, 120000);
});