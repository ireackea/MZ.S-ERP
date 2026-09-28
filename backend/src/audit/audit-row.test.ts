import { describe, expect, it } from 'vitest';
import { buildAuditRow } from './audit-row';

/**
 * The redaction contract of `AuditService.log`.
 *
 * That method used to run `redactMetadata` over the entry itself. When its write
 * moved into `buildAuditRow`, the redaction had to move with it, because a
 * builder that serialises whatever it is given will cheerfully write a password
 * into the audit trail. Nothing else would have caught that: the tests that
 * exercise `redactMetadata` call it directly, and the e2e resets do not carry a
 * secret in their metadata.
 */
describe('buildAuditRow', () => {
  it('redacts the metadata before it is written', () => {
    const row = buildAuditRow({
      action: 'TEST',
      actorId: '00000000-0000-4000-8000-00000000000a',
      actorUsername: 'tester',
      actorRole: 'SuperAdmin',
      status: 'success',
      message: 'redaction check',
      metadata: {
        password: 'hunter2',
        token: 'secret-token',
        nested: { apiKey: 'k-123' },
        safe: 'kept',
      },
    });

    const metadata = JSON.parse(String(row.metadata));
    expect(JSON.stringify(metadata)).not.toContain('hunter2');
    expect(JSON.stringify(metadata)).not.toContain('secret-token');
    expect(JSON.stringify(metadata)).not.toContain('k-123');
    expect(metadata.safe).toBe('kept');
  });

  it('maps the columns the hand-written version got wrong', () => {
    const row = buildAuditRow({
      action: 'TEST',
      actorId: '00000000-0000-4000-8000-00000000000a',
      actorUsername: 'tester',
      actorRole: 'SuperAdmin',
      status: 'success',
      message: 'the human readable line',
    });

    // `userId` and `details` are the fields; `actorId` and `message` are columns.
    expect(row).not.toHaveProperty('actorId');
    expect(row).not.toHaveProperty('message');
    expect(row.userId).toBe('00000000-0000-4000-8000-00000000000a');
    expect(row.details).toBe('the human readable line');
    expect(row.status).toBe('SUCCESS');
  });

  it('writes a null actor rather than a value the foreign key would reject', () => {
    for (const actorId of ['system', '', 'not-a-uuid', undefined as unknown as string]) {
      const row = buildAuditRow({
        action: 'TEST',
        actorId,
        actorUsername: 'tester',
        actorRole: 'SuperAdmin',
        status: 'failed',
      });
      expect(row.userId).toBeNull();
    }
  });
});
