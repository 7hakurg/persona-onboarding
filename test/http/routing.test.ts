import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import "../../src/worker/index";

const ORIGIN = "https://persona.test";

async function newSession(): Promise<string> {
  const res = await exports.default.fetch(`${ORIGIN}/api/session`, { method: "POST", headers: { Origin: ORIGIN } });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/sid=[a-f0-9]{32}/);
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  return cookie.split(";")[0]!;
}

describe("session routing", () => {
  it("keeps an existing session cookie", async () => {
    const cookie = await newSession();
    const res = await exports.default.fetch(`${ORIGIN}/api/session`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects cross-origin session creation", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/session`, { method: "POST", headers: { Origin: "https://evil.test" } });
    expect(res.status).toBe(403);
  });

  it("upgrades /agents/onboarding-agent/me with a valid cookie", async () => {
    const cookie = await newSession();
    const res = await exports.default.fetch(`${ORIGIN}/agents/onboarding-agent/me`, {
      headers: { Upgrade: "websocket", Cookie: cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });

  it("refuses the agent socket without a cookie", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/agents/onboarding-agent/me`, { headers: { Upgrade: "websocket", Origin: ORIGIN } });
    expect(res.status).toBe(401);
  });

  it("refuses direct access to a named session", async () => {
    const cookie = await newSession();
    const res = await exports.default.fetch(`${ORIGIN}/agents/onboarding-agent/someone-else`, {
      headers: { Upgrade: "websocket", Cookie: cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it("refuses cross-origin sockets", async () => {
    const cookie = await newSession();
    const res = await exports.default.fetch(`${ORIGIN}/agents/onboarding-agent/me`, {
      headers: { Upgrade: "websocket", Cookie: cookie, Origin: "https://evil.test" },
    });
    expect(res.status).toBe(403);
  });

  it("rotates the session on reset", async () => {
    const cookie = await newSession();
    const res = await exports.default.fetch(`${ORIGIN}/api/reset`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie } });
    expect(res.status).toBe(200);
    const next = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect(next).toMatch(/^sid=/);
    expect(next).not.toBe(cookie);
  });
});

describe("client config", () => {
  it("reports whether gmail is configured", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/config`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gmail: true });
  });
});
