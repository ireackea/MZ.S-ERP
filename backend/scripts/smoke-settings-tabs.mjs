// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const baseUrl = process.env.FRONTEND_URL || 'http://localhost:4173';
const outputDir = process.env.SCREENSHOT_DIR || path.resolve(process.cwd(), '..', 'artifacts', 'phase2');
const executableCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROMIUM_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const tabs = [
  { key: 'general-settings', label: 'الإعدادات العامة' },
  { key: 'users-and-roles', label: 'المستخدمون والأدوار' },
  { key: 'permissions-matrix', label: 'مصفوفة الصلاحيات' },
  { key: 'backup-and-restore', label: 'النسخ الاحتياطي' },
  { key: 'system-reset', label: 'إعادة الضبط' },
  { key: 'audit-logs', label: 'سجلات التدقيق' },
  { key: 'offline-settings', label: 'إعدادات الأوفلاين' },
  { key: 'printing-templates', label: 'قوالب الطباعة' },
  { key: 'theme-and-localization', label: 'الثيم واللغة' },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const slugify = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const launch = async () => {
  const options = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  };

  if (executableCandidates.length > 0) {
    options.executablePath = executableCandidates[0];
  }

  return puppeteer.launch(options);
};

const authenticateSession = async (page) => {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'superadmin',
        password: 'SecurePassword2026!',
      }),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(`Login failed with ${response.status}: ${text}`);
    }

    if (payload?.user) {
      localStorage.setItem('feed_factory_jwt_user', JSON.stringify(payload.user));
      localStorage.removeItem('feed_factory_jwt_token');
      localStorage.setItem('feed_factory_last_login_username', 'superadmin');
      window.dispatchEvent(new Event('feed_factory_auth_session_changed'));
    }

    return payload;
  });
};

const clickTab = async (page, label) => {
  const clicked = await page.evaluate((tabLabel) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((button) => button.textContent?.trim().includes(tabLabel));
    if (!target) return false;
    target.click();
    return true;
  }, label);

  if (!clicked) {
    throw new Error(`Settings tab not found: ${label}`);
  }
};

const saveScreenshot = async (page, name) => {
  const filePath = path.join(outputDir, `${slugify(name)}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
};

const main = async () => {
  await mkdir(outputDir, { recursive: true });

  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForSelector('#login-username', { timeout: 120000 });
    await authenticateSession(page);
    await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle2', timeout: 120000 });
    await delay(1500);

    const screenshots = {};

    for (const tab of tabs) {
      await clickTab(page, tab.label);
      await delay(1200);
      screenshots[tab.key] = await saveScreenshot(page, tab.key);
    }

    console.log(JSON.stringify({ ok: true, screenshots }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
};

main();