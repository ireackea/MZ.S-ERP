import { describe, expect, it, afterEach } from 'vitest';
import type { Request } from 'express';
import { extractClientIp } from './global-rate-limit';

/**
 * The client address is the key every rate limit in this product is bucketed by.
 *
 * It used to be read as the *left-most* `X-Forwarded-For` entry, which is the one
 * a caller writes: every proxy in a chain appends the address it received the
 * request from, so the left-most entry is whatever the client felt like sending.
 * With the default stack publishing port 3001 straight to the host, nothing
 * rewrote that header, so a client could put a different value on every request
 * and receive a different rate-limit bucket each time — which made `auth` at 20
 * per 15 minutes, the ceiling on brute force, a suggestion.
 *
 * `main.ts` had the matching half of the bug: `trust proxy` was hardcoded to 1
 * while no proxy existed in front of the process, so Express also believed the
 * header. Both are now driven by TRUSTED_PROXY_HOPS, and this file pins the
 * behaviour that must not regress.
 */
const request = (headers: Record<string, string | string[]>, remoteAddress = '10.0.0.9'): Request =>
  ({ headers, socket: { remoteAddress } }) as unknown as Request;

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe('extractClientIp', () => {
  it('ignores a forwarded header entirely when no proxy is in front', () => {
    process.env.TRUSTED_PROXY_HOPS = '0';

    // The attack this closes: a fresh value per request is a fresh bucket.
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.9');
    expect(extractClientIp(request({ 'x-forwarded-for': '5.6.7.8' }))).toBe('10.0.0.9');
    expect(extractClientIp(request({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }))).toBe('10.0.0.9');
  });

  it('defaults to ignoring the header when TRUSTED_PROXY_HOPS is unset', () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.9');
  });

  it('reads the right-most hop, not the caller-supplied left-most one, behind one proxy', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';

    // nginx appends, so the last entry is the address it saw. The first entry is
    // the attacker's and must never decide the bucket.
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, '172.18.0.4'))).toBe(
      '203.0.113.7',
    );
  });

  it('walks back exactly as many hops as it was told to', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 198.51.100.2' }))).toBe(
      '203.0.113.7',
    );
  });

  it('accepts a header sent more than once', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(extractClientIp(request({ 'x-forwarded-for': ['1.2.3.4', '203.0.113.7'] }))).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to the socket address when the header is absent, empty or unparseable', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(extractClientIp(request({}))).toBe('10.0.0.9');
    expect(extractClientIp(request({ 'x-forwarded-for': '' }))).toBe('10.0.0.9');
    expect(extractClientIp(request({ 'x-forwarded-for': '   ,  ' }))).toBe('10.0.0.9');
  });

  it('never returns an empty key, because an empty key is one shared bucket', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(extractClientIp(request({}, ''))).toBe('unknown');
  });

  it('refuses a nonsensical hop count rather than trusting the header', () => {
    for (const value of ['abc', '-1', '0', '999', 'NaN', '']) {
      process.env.TRUSTED_PROXY_HOPS = value;
      expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.9');
    }
  });

  it('ignores a header shorter than the configured chain rather than reading its first entry', () => {
    // This is the case that would otherwise reopen the bypass: with more hops
    // configured than the header carries, the only entry available is the one the
    // caller wrote, so the header has to be discarded instead of indexed into.
    process.env.TRUSTED_PROXY_HOPS = '3';
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.9');
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('10.0.0.9');
    expect(extractClientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 198.51.100.2' }))).toBe(
      '10.0.0.9',
    );
  });
});
