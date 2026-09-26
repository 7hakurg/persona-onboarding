import { describe, expect, it } from "vitest";
import { slidingWindow } from "../../src/worker/limits/rate-window";

describe("slidingWindow", () => {
  it("allows up to the limit within the window", () => {
    let hits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = slidingWindow(hits, 1000 + i, 3, 60_000);
      expect(r.allowed).toBe(true);
      hits = r.hits;
    }
    expect(slidingWindow(hits, 1010, 3, 60_000).allowed).toBe(false);
  });
  it("forgets hits older than the window", () => {
    const r = slidingWindow([0, 1, 2], 60_010, 3, 60_000);
    expect(r).toEqual({ allowed: true, hits: [60_010] });
  });
  it("does not record a rejected hit", () => {
    const r = slidingWindow([1, 2, 3], 4, 3, 60_000);
    expect(r).toEqual({ allowed: false, hits: [1, 2, 3] });
  });
});
