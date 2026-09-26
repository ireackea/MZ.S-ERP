import { describe, expect, it } from 'vitest';
import { calculateRetryDelay, MAX_MUTATION_ATTEMPTS, shouldDeadLetter } from './mutationQueueService';

describe('mutation queue durability policy', () => {
  it('uses bounded exponential retry delays', () => {
    expect(calculateRetryDelay(1)).toBe(2_000);
    expect(calculateRetryDelay(2)).toBe(4_000);
    expect(calculateRetryDelay(7)).toBe(128_000);
    expect(calculateRetryDelay(99)).toBe(300_000);
  });

  it('moves exhausted mutations to dead-letter', () => {
    expect(shouldDeadLetter(MAX_MUTATION_ATTEMPTS - 1)).toBe(false);
    expect(shouldDeadLetter(MAX_MUTATION_ATTEMPTS)).toBe(true);
  });
});
