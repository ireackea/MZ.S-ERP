import puppeteer from 'puppeteer';

const baseUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const executableCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROMIUM_PATH,
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

const main = async () => {
  const browser = await launch();
  const page = await browser.newPage();
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const consoleErrors = [];

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
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForSelector('#login-username', { timeout: 30000 });
    await page.type('#login-username', 'superadmin');
    await page.type('#login-password', 'SecurePassword2026!');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }).catch(() => null),
    ]);

    const afterLogin = await capturePageState(page, 'post-login');

    const routes = ['/formulation', '/stocktaking', '/users'];
    const routeStates = [];

    for (const route of routes) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle2', timeout: 120000 });
      await page.waitForTimeout(1500);
      routeStates.push(await capturePageState(page, route));
    }

    const result = {
      ok: true,
      afterLogin,
      routeStates,
      pageErrors,
      failedRequests,
      badResponses,
      consoleErrors,
      findings,
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
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
