import { describe, expect, test } from "vitest";

import { OverlayChunkCache } from "./overlayChunkCache";

describe("OverlayChunkCache", () => {
  test("evicts least recently used chunks when capacity is exceeded", () => {
    const cache = new OverlayChunkCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    cache.prune(new Set());

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  test("retains viewport chunks during prune", () => {
    const cache = new OverlayChunkCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.prune(new Set(["a", "b"]));

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(true);
  });

  test("keeps visible chunks even when they exceed nominal capacity", () => {
    const cache = new OverlayChunkCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.prune(new Set(["a", "b", "c"]));

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });
});
