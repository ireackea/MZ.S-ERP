// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
const FINGERPRINT_KEY = 'feed_factory_device_fingerprint';

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const computeHash = async (payload: string): Promise<string> => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return toHex(digest);
  }

  let hash = 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash << 5) - hash + payload.charCodeAt(index);
    hash |= 0;
  }
  return `fallback-${Math.abs(hash)}`;
};

export const generateDeviceFingerprint = async (): Promise<string> => {
  const stablePayload = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    String(screen.width),
    String(screen.height),
    String(new Date().getTimezoneOffset()),
    String(navigator.hardwareConcurrency || 0),
    String((navigator as any).deviceMemory || 0),
  ].join('|');

  return computeHash(stablePayload);
};

export const getDeviceFingerprint = async (): Promise<string> => {
  const existing = localStorage.getItem(FINGERPRINT_KEY);
  if (existing) return existing;

  const generated = await generateDeviceFingerprint();
  localStorage.setItem(FINGERPRINT_KEY, generated);
  return generated;
};
