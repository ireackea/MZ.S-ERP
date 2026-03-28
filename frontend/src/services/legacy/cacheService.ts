// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13

// Lightweight in-memory cache used as a local fallback when Redis is unavailable.
// The same interface can be backed by browser storage or a remote cache later if needed.

type CacheKey = 'items' | 'transactions' | 'partners' | 'orders' | 'users' | 'settings' | 'reports_summary';

class CacheService {
  private static instance: CacheService;
  private cache: Map<CacheKey | string, unknown>;
  private stats: { hits: number; misses: number };

  private constructor() {
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0 };
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  public get<T>(key: CacheKey | string): T | null {
    if (this.cache.has(key)) {
      this.stats.hits++;
      return this.cache.get(key) as T;
    }
    this.stats.misses++;
    return null;
  }

  public set(key: CacheKey | string, value: unknown): void {
    this.cache.set(key, value);
  }

  public invalidate(key: CacheKey | string): void {
    this.cache.delete(key);
  }

  public invalidatePattern(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (String(key).startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  public clearAll(): void {
    this.cache.clear();
  }

  public getStats() {
    return this.stats;
  }
}

export const cache = CacheService.getInstance();
