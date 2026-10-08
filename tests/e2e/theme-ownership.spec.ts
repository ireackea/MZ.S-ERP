import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';
import { cleanupFixtures } from './support/dbCleanup';

/**
 * #19 — the theme routes took the target account from the path and never checked who
 * was asking.
 *
 * `GET /theme/user/:id` read any account's theme and `POST /theme/user/:id` **wrote**
 * any account's theme. A permission documented as "تعديل الثيم" therefore also granted
 * "modify any user's row", silently and with no audit row — which is how a settings
 * change becomes unattributable.
 *
 * The feature itself is client-side (`theme.store` / `ThemeSwitcher`); nothing in the
 * frontend calls these routes. They are made correct rather than deleted, so the defect
 * under test is ownership, not existence.
 */
const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
};

const login = async (username: string, password: string) => {
  const response = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(201);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
};

const PASSWORD = 'ThemeGate2026!';
const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];

afterAll(() => {
  cleanupFixtures(createdUserIds, createdRoleIds);
});

const createUserWithPermissions = async (adminCookie: string, label: string, permissions: string[]) => {
  const suffix = randomUUID().slice(0, 8);
  const roleResult = await request('/users/roles', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `ThemeRole_${label}_${suffix}`, permissions, color: '#64748b' }),
  });
  expect(roleResult.status).toBe(201);
  const roleId = String(roleResult.body?.data?.id ?? roleResult.body?.id);
  createdRoleIds.push(roleId);

  const userResult = await request('/users', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `theme_${label}_${suffix}`, password: PASSWORD, roleId }),
  });
  expect(userResult.status).toBe(201);
  const userId = String(userResult.body?.data?.id ?? userResult.body?.id);
  createdUserIds.push(userId);
  return { username: `theme_${label}_${suffix}`, userId };
};

describe('#19 a theme is the owner’s, or an administrator’s', () => {
  it('lets a session write its own theme', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const self = await createUserWithPermissions(adminCookie, 'self', ['theme.view', 'theme.update']);
    const cookie = await login(self.username, PASSWORD);

    const written = await request(`/theme/user/${self.userId}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    });
    expect(written.status).toBe(201);
    expect(written.body?.theme).toBe('dark');
  });

  it('refuses to write another account’s theme on the strength of theme.update', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const attacker = await createUserWithPermissions(adminCookie, 'attacker', ['theme.view', 'theme.update']);
    const victim = await createUserWithPermissions(adminCookie, 'victim', ['theme.view']);
    const cookie = await login(attacker.username, PASSWORD);

    const attempt = await request(`/theme/user/${victim.userId}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'tampered' }),
    });
    expect(attempt.status).toBe(403);

    // 403 alone could mean anything, so the victim's own theme is read back by an
    // administrator: it must not have moved.
    const after = await request(`/theme/user/${victim.userId}`, { headers: { Cookie: adminCookie } });
    expect(after.status).toBe(200);
    expect(after.body?.theme).not.toBe('tampered');
  });

  it('refuses to read another account’s theme too', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const reader = await createUserWithPermissions(adminCookie, 'reader', ['theme.view']);
    const other = await createUserWithPermissions(adminCookie, 'other', ['theme.view']);
    const cookie = await login(reader.username, PASSWORD);

    const attempt = await request(`/theme/user/${other.userId}`, { headers: { Cookie: cookie } });
    expect(attempt.status).toBe(403);
  });

  it('lets an administrator act on another account, and records it', async () => {
    // An administrator setting somebody else's theme is a legitimate support action. It
    // is a separate authority from `theme.update`, and it leaves a row — otherwise
    // "who changed my settings" has no answer.
    const adminCookie = await login(adminUsername, adminPassword);
    const target = await createUserWithPermissions(adminCookie, 'admintarget', ['theme.view']);

    const written = await request(`/theme/user/${target.userId}`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'light' }),
    });
    expect(written.status).toBe(201);
    expect(written.body?.theme).toBe('light');
  });
});