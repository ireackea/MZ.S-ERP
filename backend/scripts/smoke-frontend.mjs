// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const baseUrl = process.env.FRONTEND_URL || 'http://localhost:4173';
const outputDir = process.env.SCREENSHOT_DIR || path.resolve(process.cwd(), '..', 'artifacts', 'phase0.2');
const executableCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROMIUM_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const findings = [];

const pushFinding = (type, message, details = {}) => {
  findings.push({ type, message, ...details });
};

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

const capturePageState = async (page, route) => {
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1200) || '');
  return {
    route,
    url: page.url(),
    bodyText,
  };
};

const slugify = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const saveScreenshot = async (page, name) => {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${slugify(name)}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
};

const saveDebugArtifacts = async (page, name) => {
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = await saveScreenshot(page, name);
  const htmlPath = path.join(outputDir, `${slugify(name)}.html`);
  const textPath = path.join(outputDir, `${slugify(name)}.txt`);
  await writeFile(htmlPath, await page.content(), 'utf8');
  await writeFile(textPath, await page.evaluate(() => document.body?.innerText || ''), 'utf8');
  return { screenshotPath, htmlPath, textPath };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 });
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const consoleErrors = [];
  const screenshots = {};

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    pushFinding('pageerror', error.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      consoleErrors.push(text);
      pushFinding('console-error', text);
    }
  });

  page.on('requestfailed', (request) => {
    const failure = `${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'request failed'}`;
    failedRequests.push(failure);
    pushFinding('requestfailed', failure);
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      const item = `${response.status()} ${response.request().method()} ${response.url()}`;
      badResponses.push(item);
      pushFinding('http-error', item);
    }
  });

  try {
    await mkdir(outputDir, { recursive: true });
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForSelector('#login-username', { timeout: 120000 });
    await page.type('#login-username', 'superadmin');
    await page.type('#login-password', 'SecurePassword2026!');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }).catch(() => null),
    ]);

    const afterLogin = await capturePageState(page, 'post-login');
    screenshots.dashboard = await saveScreenshot(page, 'dashboard');

    const routes = [
      { route: '/dashboard', key: 'dashboard' },
      { route: '/reports', key: 'reports' },
      { route: '/operations', key: 'daily-operations' },
    ];
    const routeStates = [];

    for (const routeConfig of routes) {
      await page.goto(`${baseUrl}${routeConfig.route}`, { waitUntil: 'networkidle2', timeout: 120000 });
      await delay(1500);
      routeStates.push(await capturePageState(page, routeConfig.route));
      screenshots[routeConfig.key] = await saveScreenshot(page, routeConfig.key);
    }

    await page.setOfflineMode(true);
    await delay(1500);
    screenshots.dailyOperationsOffline = await saveScreenshot(page, 'daily-operations-offline');
    const offlineBannerVisible = await page.evaluate(() => document.body?.innerText?.includes('أوفلاين') || document.body?.innerText?.includes('بدون اتصال') || false);
    await page.setOfflineMode(false);

    const result = {
      ok: true,
      afterLogin,
      routeStates,
      screenshots,
      offlineBannerVisible,
      pageErrors,
      failedRequests,
      badResponses,
      consoleErrors,
      findings,
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const debugArtifacts = await saveDebugArtifacts(page, 'login-debug');
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      currentUrl: page.url(),
      debugArtifacts,
      findings,
      pageErrors,
      failedRequests,
      badResponses,
      consoleErrors,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
};

main();
