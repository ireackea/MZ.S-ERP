import { Logger, ServiceUnavailableException } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const logger = new Logger('PdfBrowser');

/**
 * FC-OPS-002 — one place that knows how Chrome is resolved, and what to say when
 * it is not there.
 *
 * Three services call `puppeteer.launch` directly: POST /render-pdf,
 * POST /reports/generate and POST /reports/print. None wrapped the call, so a
 * container built without Chrome answered a PDF request with a 500 and a
 * "Could not find Chrome (ver. 147.0.7727.56)" stack trace — a build-time
 * detail reported as a runtime error, with no hint that the build had been made
 * without the browser.
 *
 * The Docker build can legitimately omit Chrome (see `PUPPETEER_SKIP_CHROME` in
 * backend/Dockerfile), so a missing browser is a configuration state to explain,
 * not a crash.
 */

export const PUPPETEER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

/** Where the browser cache lives in the production image, and on a dev machine. */
const cacheDirs = () => {
  const configured = String(process.env.PUPPETEER_CACHE_DIR || '').trim();
  return [
    ...(configured ? [configured] : []),
    '/home/appuser/.cache/puppeteer',
    '/root/.cache/puppeteer',
    `${process.env.HOME || ''}/.cache/puppeteer`,
  ].filter(Boolean);
};

const exists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves the browser executable, or explains precisely why it cannot.
 * Returns null when no cache directory holds one.
 */
export const resolveBrowserExecutable = async (): Promise<string | null> => {
  // Puppeteer can resolve it itself, which is the normal case.
  try {
    const resolved = puppeteer.executablePath();
    if (resolved && (await exists(resolved))) return resolved;
  } catch {
    // fall through to the cache scan
  }

  for (const dir of cacheDirs()) {
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!entry.startsWith('chrome')) continue;
        for (const candidate of [
          `${dir}/${entry}/chrome-linux64/chrome`,
          `${dir}/${entry}/chrome-linux/chrome`,
        ]) {
          if (await exists(candidate)) return candidate;
        }
      }
    } catch {
      // directory absent; try the next candidate
    }
  }
  return null;
};

/** Throws a 503 that names the build flag, or null when a browser is available. */
export const assertBrowserAvailable = async (): Promise<string | null> => {
  const executable = await resolveBrowserExecutable();
  if (executable) return executable;

  logger.error('No Chrome binary found. PDF generation will fail until the image is built with it.');
  throw new ServiceUnavailableException(
    'PDF generation is unavailable: this deployment was built without a browser. '
    + 'Rebuild the backend image without PUPPETEER_SKIP_CHROME, or run the host with a Chrome install.',
  );
};

/**
 * Launches a browser or fails with the same explanation. Callers must close it;
 * a launch that throws leaves nothing to close.
 */
export const launchBrowser = async (options: { timeout?: number; protocolTimeout?: number } = {}) => {
  const executablePath = await assertBrowserAvailable();
  try {
    return await puppeteer.launch({
      headless: true,
      args: PUPPETEER_LAUNCH_ARGS,
      ...(executablePath ? { executablePath } : {}),
      ...(options.timeout ? { timeout: options.timeout } : {}),
      ...(options.protocolTimeout ? { protocolTimeout: options.protocolTimeout } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Chrome failed to launch: ${message}`);
    throw new ServiceUnavailableException(
      `PDF generation is unavailable: Chrome could not start (${message}).`,
    );
  }
};
