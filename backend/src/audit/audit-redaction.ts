/**
 * FC-AUD-001 — audit redaction.
 *
 * Audit metadata is a durable, widely-readable record, so anything that looks
 * like a credential must never reach it. Redaction is applied centrally here
 * rather than trusting every call site to remember.
 */

const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd|code)?|secret|token|api[-_]?key|apikey|authorization|auth[-_]?header|cookie|session[-_]?id|otp|pin|code[-_]?verif|confirmation|challenge|credential|private[-_]?key|signature|salt|hash)/i;

/**
 * Identifiers that merely *look* sensitive because of the word above. A
 * challengeId names an already-consumed, single-use record; it is not the secret
 * that authorises anything, so redacting it would only make the audit trail
 * useless. Session ids stay masked — they are live credentials.
 */
const NON_SECRET_IDENTIFIER = /^challenge_?id$/i;

export const isSensitiveKey = (key: string): boolean => {
  const name = String(key || '');
  if (NON_SECRET_IDENTIFIER.test(name)) return false;
  return SENSITIVE_KEY_PATTERN.test(name);
};

const REDACTED = '[REDACTED]';

const MAX_DEPTH = 6;
const MAX_ARRAY_SAMPLE = 50;
const MAX_STRING_LENGTH = 2000;

const looksLikeJwt = (value: string) => /^eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/.test(value);

const looksLikeBearer = (value: string) => /^\s*(bearer|basic)\s+\S+/i.test(value);

const looksLikeLongHexOrBase64 = (value: string) =>
  value.length >= 32 && /^[A-Za-z0-9+/_=-]+$/.test(value) && !/\s/.test(value);

export const redactValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return typeof value === 'bigint' ? value.toString() : value;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };

  if (depth >= MAX_DEPTH) return '[TRUNCATED]';

  if (Array.isArray(value)) {
    const sampled = value.slice(0, MAX_ARRAY_SAMPLE).map((entry) => redactValue(entry, depth + 1));
    if (value.length > MAX_ARRAY_SAMPLE) {
      sampled.push(`...${value.length - MAX_ARRAY_SAMPLE} more entries omitted`);
    }
    return sampled;
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
        continue;
      }
      // Even under a benign key, a value that *is* a credential gets masked.
      if (typeof entry === 'string' && (looksLikeJwt(entry) || looksLikeBearer(entry))) {
        output[key] = REDACTED;
        continue;
      }
      output[key] = redactValue(entry, depth + 1);
    }
    return output;
  }

  return String(value);
};

/** Redacts a metadata bag, keeping plain data readable. */
export const redactMetadata = (
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> | undefined => {
  if (!metadata) return undefined;
  return redactValue(metadata, 0) as Record<string, unknown>;
};

/** True when the payload contained something that had to be masked. */
export const containsSensitiveMaterial = (payload: unknown): boolean => {
  const redacted = JSON.stringify(redactValue(payload, 0)) || '';
  return redacted.includes(REDACTED);
};

export { REDACTED, looksLikeLongHexOrBase64 };
