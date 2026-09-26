import { describe, expect, it } from 'vitest';
import { assertStorageKeyAllowed, findStorageEntry } from './storageOwnership';

describe('storage ownership guard', () => {
  it('accepts registered business and presentation keys', () => {
    expect(() => assertStorageKeyAllowed('feed_factory_transactions')).not.toThrow();
    expect(() => assertStorageKeyAllowed('ff_theme_preference_v1')).not.toThrow();
  });

  it('rejects an unregistered key', () => {
    expect(() => assertStorageKeyAllowed('feed_factory_new_business_record')).toThrow('STORAGE_KEY_NOT_REGISTERED');
  });

  it('requires the key and area to match', () => {
    expect(() => assertStorageKeyAllowed('FeedFactoryMutationDB', 'localStorage')).toThrow('STORAGE_KEY_NOT_REGISTERED');
    expect(findStorageEntry('FeedFactoryMutationDB')?.ownership).toBe('OFFLINE_QUEUE');
  });
});
