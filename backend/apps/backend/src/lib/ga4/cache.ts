/**
 * TTL cache with in-flight de-duplication, for successful GA4 reports only.
 *
 * Two separate jobs that are easy to confuse:
 *
 *  - **Caching** keeps a *finished* report for `ttlMs`, so refreshing the
 *    dashboard does not spend Data API quota on an answer we already have.
 *  - **De-duplication** joins callers onto an *in-progress* request. Two admins
 *    loading the dashboard in the same second produce one Google call, not two,
 *    even though nothing is cached yet.
 *
 * Failures are never cached. A permission error resolved by granting access in
 * the GA4 UI must not keep answering 403 for the rest of the TTL, and an
 * unavailable API must not lock in its own outage.
 */

export type CacheStatus = "hit" | "miss" | "coalesced";

export type CacheMeta = {
  status: CacheStatus;
  /** Age of the returned payload, `0` for a freshly fetched one. */
  ageSeconds: number;
  ttlSeconds: number;
};

export type Cached<T> = { value: T; cache: CacheMeta };

type Entry<T> = { value: T; storedAt: number };

/**
 * Upper bound on distinct keys. The key space is small and bounded by the route
 * surface (one realtime shape, three summary periods, one health), so this only
 * ever trips if a future caller starts keying on user input — in which case
 * evicting is much better than growing without limit.
 */
const MAX_ENTRIES = 64;

export class Ga4Cache {
  #entries = new Map<string, Entry<unknown>>();
  #inflight = new Map<string, Promise<unknown>>();
  #now: () => number;

  /** `now` is injectable so tests can advance time without sleeping. */
  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * Return the cached value, join an in-flight load, or start one.
   *
   * `ttlMs <= 0` disables the cache but *keeps* de-duplication: concurrent
   * callers still share one Google call, which is desirable regardless of
   * whether the result is worth keeping afterwards.
   */
  async fetch<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<Cached<T>> {
    const ttlSeconds = Math.max(0, Math.round(ttlMs / 1000));

    if (ttlMs > 0) {
      const entry = this.#entries.get(key) as Entry<T> | undefined;
      if (entry) {
        const age = this.#now() - entry.storedAt;
        if (age < ttlMs) {
          return {
            value: entry.value,
            cache: {
              status: "hit",
              ageSeconds: Math.max(0, Math.floor(age / 1000)),
              ttlSeconds,
            },
          };
        }
        this.#entries.delete(key);
      }
    }

    const existing = this.#inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      // Joiners share the originator's outcome, including its rejection.
      const value = await existing;
      return { value, cache: { status: "coalesced", ageSeconds: 0, ttlSeconds } };
    }

    const pending = loader();
    this.#inflight.set(key, pending);

    let value: T;
    try {
      value = await pending;
    } finally {
      // Cleared on both paths, so a failed load never blocks the next attempt.
      this.#inflight.delete(key);
    }

    if (ttlMs > 0) {
      this.#store(key, value);
    }

    return { value, cache: { status: "miss", ageSeconds: 0, ttlSeconds } };
  }

  #store<T>(key: string, value: T): void {
    if (this.#entries.size >= MAX_ENTRIES && !this.#entries.has(key)) {
      // Map preserves insertion order, so the first key is the oldest write.
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, storedAt: this.#now() });
  }

  /** Drop everything. Used when configuration changes under a live process. */
  clear(): void {
    this.#entries.clear();
    this.#inflight.clear();
  }
}
