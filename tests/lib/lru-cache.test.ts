import { describe, expect, it } from "vitest";

import { BoundedTtlCache } from "@/lib/lru-cache";

describe("BoundedTtlCache", () => {
  it("stores and returns values until they expire", () => {
    let now = 1_000;
    const cache = new BoundedTtlCache<number>({ maxSize: 4, ttlMs: 60_000, now: () => now });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    now += 60_000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least-recently-used entry over capacity", () => {
    const now = 1_000;
    const cache = new BoundedTtlCache<number>({ maxSize: 2, ttlMs: 60_000, now: () => now });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("keeps size at or under maxSize under hostile write volume", () => {
    const now = 1_000;
    const cache = new BoundedTtlCache<number>({ maxSize: 8, ttlMs: 60_000, now: () => now });
    for (let i = 0; i < 1_000; i += 1) {
      cache.set(`coord-${i}`, i);
    }
    expect(cache.size).toBe(8);
    expect(cache.get("coord-999")).toBe(999);
    expect(cache.get("coord-0")).toBeUndefined();
  });

  it("purges expired entries on writes instead of letting them pile up", () => {
    let now = 1_000;
    const cache = new BoundedTtlCache<number>({ maxSize: 8, ttlMs: 60_000, now: () => now });
    for (let i = 0; i < 8; i += 1) cache.set(`k-${i}`, i);
    now += 61_000;
    cache.set("fresh", 42);
    expect(cache.size).toBe(1);
    expect(cache.get("fresh")).toBe(42);
    expect(cache.get("k-0")).toBeUndefined();
  });

  it("overwrites an existing key without growing", () => {
    const cache = new BoundedTtlCache<number>({ maxSize: 2, ttlMs: 60_000 });
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("rejects invalid construction options", () => {
    expect(() => new BoundedTtlCache({ maxSize: 0, ttlMs: 1_000 })).toThrow();
    expect(() => new BoundedTtlCache({ maxSize: 1.5, ttlMs: 1_000 })).toThrow();
    expect(() => new BoundedTtlCache({ maxSize: 4, ttlMs: 0 })).toThrow();
  });
});
