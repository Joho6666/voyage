/**
 * Bounded in-memory cache with TTL and least-recently-used eviction.
 *
 * Every unbounded `Map` used as a cache is a latent memory leak: the key space
 * usually comes from request input (coordinates, ids), so a scripted client can
 * grow the map faster than TTL checks prune it — expired entries only
 * disappear when their key is probed again. This primitive enforces a hard
 * ceiling: it evicts expired entries eagerly on writes and then trims to
 * maxSize in LRU order. Intended for provider-response caches whose sole job
 * is protecting paid API quota.
 */
export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { maxSize: number; ttlMs: number; now?: () => number }) {
    if (!Number.isInteger(options.maxSize) || options.maxSize < 1) {
      throw new Error("BoundedTtlCache requires an integer maxSize >= 1");
    }
    if (options.ttlMs <= 0) {
      throw new Error("BoundedTtlCache requires ttlMs > 0");
    }
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  /** Returns the cached value, or undefined when absent or expired. Refreshes recency on hit. */
  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert to move the key to the back of the Map's insertion order.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    this.evict();
  }

  /** Number of live (non-expired) entries. */
  get size(): number {
    const now = this.now();
    let live = 0;
    for (const hit of this.entries.values()) {
      if (hit.expiresAt > now) live += 1;
    }
    return live;
  }

  clear(): void {
    this.entries.clear();
  }

  private evict(): void {
    const now = this.now();
    // Expired entries hold memory but no value; drop them before trimming.
    for (const [key, hit] of this.entries) {
      if (hit.expiresAt <= now) this.entries.delete(key);
    }
    // Map iterates in insertion order, so the first keys are the least recently used.
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
