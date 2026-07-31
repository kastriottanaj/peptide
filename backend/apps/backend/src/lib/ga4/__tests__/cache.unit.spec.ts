import { Ga4Cache } from "../cache";

/** Controllable clock, so TTL expiry does not need real waiting. */
function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A promise this test can resolve on demand, to hold a load open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Ga4Cache", () => {
  it("reports a miss on first load and a hit within the TTL", async () => {
    const time = clock();
    const cache = new Ga4Cache(time.now);
    const loader = jest.fn().mockResolvedValue({ activeUsers: 3 });

    const first = await cache.fetch("k", 60_000, loader);
    expect(first.cache.status).toBe("miss");
    expect(first.cache.ageSeconds).toBe(0);
    expect(first.cache.ttlSeconds).toBe(60);

    time.advance(30_000);

    const second = await cache.fetch("k", 60_000, loader);
    expect(second.cache.status).toBe("hit");
    expect(second.cache.ageSeconds).toBe(30);
    expect(second.value).toEqual({ activeUsers: 3 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reloads once the TTL has passed", async () => {
    const time = clock();
    const cache = new Ga4Cache(time.now);
    const loader = jest
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await cache.fetch("k", 60_000, loader);
    time.advance(60_001);

    const result = await cache.fetch("k", 60_000, loader);
    expect(result.cache.status).toBe("miss");
    expect(result.value).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keys entries independently", async () => {
    const cache = new Ga4Cache(clock().now);
    const loader = jest.fn().mockResolvedValue("x");

    await cache.fetch("summary:7d", 60_000, loader);
    await cache.fetch("summary:30d", 60_000, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent callers onto one load", async () => {
    const cache = new Ga4Cache(clock().now);
    const gate = deferred<string>();
    const loader = jest.fn().mockReturnValue(gate.promise);

    const a = cache.fetch("k", 60_000, loader);
    const b = cache.fetch("k", 60_000, loader);
    const c = cache.fetch("k", 60_000, loader);

    gate.resolve("shared");
    const [first, second, third] = await Promise.all([a, b, c]);

    // One Google call, three answers.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(first.cache.status).toBe("miss");
    expect(second.cache.status).toBe("coalesced");
    expect(third.cache.status).toBe("coalesced");
    expect(second.value).toBe("shared");
  });

  it("does not cache a failure", async () => {
    const cache = new Ga4Cache(clock().now);
    const loader = jest
      .fn()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.fetch("k", 60_000, loader)).rejects.toThrow(
      "permission denied",
    );

    // Granting access in the GA4 UI must take effect immediately, not after
    // the TTL of an error nobody wanted kept.
    const retry = await cache.fetch("k", 60_000, loader);
    expect(retry.value).toBe("recovered");
    expect(retry.cache.status).toBe("miss");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("propagates a failure to every coalesced caller and clears the slot", async () => {
    const cache = new Ga4Cache(clock().now);
    const gate = deferred<string>();
    const loader = jest
      .fn()
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValueOnce("later");

    const a = cache.fetch("k", 60_000, loader);
    const b = cache.fetch("k", 60_000, loader);
    gate.reject(new Error("unavailable"));

    await expect(a).rejects.toThrow("unavailable");
    await expect(b).rejects.toThrow("unavailable");

    const after = await cache.fetch("k", 60_000, loader);
    expect(after.value).toBe("later");
  });

  it("still de-duplicates when caching is switched off", async () => {
    const cache = new Ga4Cache(clock().now);
    const gate = deferred<string>();
    const loader = jest.fn().mockReturnValue(gate.promise);

    const a = cache.fetch("k", 0, loader);
    const b = cache.fetch("k", 0, loader);
    gate.resolve("shared");
    await Promise.all([a, b]);

    expect(loader).toHaveBeenCalledTimes(1);

    // …but nothing is retained afterwards.
    const next = await cache.fetch("k", 0, jest.fn().mockResolvedValue("fresh"));
    expect(next.cache.status).toBe("miss");
    expect(next.value).toBe("fresh");
  });

  it("evicts the oldest entry rather than growing without limit", async () => {
    const cache = new Ga4Cache(clock().now);
    const loader = jest.fn().mockImplementation((): Promise<string> => Promise.resolve("v"));

    for (let i = 0; i < 70; i++) {
      await cache.fetch(`key-${i}`, 60_000, loader);
    }

    // The first key was pushed out; the most recent is still there.
    const oldest = await cache.fetch("key-0", 60_000, loader);
    expect(oldest.cache.status).toBe("miss");

    const newest = await cache.fetch("key-69", 60_000, loader);
    expect(newest.cache.status).toBe("hit");
  });

  it("clears everything on demand", async () => {
    const cache = new Ga4Cache(clock().now);
    const loader = jest.fn().mockResolvedValue("v");

    await cache.fetch("k", 60_000, loader);
    cache.clear();
    const result = await cache.fetch("k", 60_000, loader);

    expect(result.cache.status).toBe("miss");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
