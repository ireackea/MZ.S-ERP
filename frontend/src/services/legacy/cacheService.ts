
// 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�����7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"� Redis 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�
// 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�: 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9  7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7��"7�"�7�"�7�"�7�"� 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� (LocalStorage) 7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�

type CacheKey = 'items' | 'transactions' | 'partners' | 'orders' | 'users' | 'settings' | 'reports_summary';

class CacheService {
  private static instance: CacheService;
  private cache: Map<string, any>;
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

  // Get data from memory (Simulating Redis GET)
  public get<T>(key: string): T | null {
    if (this.cache.has(key)) {
      this.stats.hits++;
      // console.debug(`[Cache Hit] Key: ${key}`); // Uncomment for debugging
      return this.cache.get(key) as T;
    }
    this.stats.misses++;
    // console.debug(`[Cache Miss] Key: ${key}`);
    return null;
  }

  // Set data to memory (Simulating Redis SET)
  public set(key: string, value: any): void {
    this.cache.set(key, value);
  }

  // Invalidate specific key (Simulating Redis DEL)
  public invalidate(key: string): void {
    this.cache.delete(key);
  }

  // Invalidate multiple keys (e.g., when a transaction happens, clear reports)
  public invalidatePattern(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
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
