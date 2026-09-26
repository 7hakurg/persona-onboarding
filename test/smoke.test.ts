import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import "../src/worker/index";

describe("worker smoke", () => {
  it("responds to health checks", async () => {
    const res = await exports.default.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
