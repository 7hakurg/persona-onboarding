import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/worker/index";
import { agentNamed } from "../agent/helpers";
import { GMAIL_COMPOSE, GMAIL_MODIFY } from "../../src/worker/gmail/google";

const ORIGIN = "https://persona.test";

async function session() {
  const res = await exports.default.fetch(`${ORIGIN}/api/session`, { method: "POST", headers: { Origin: ORIGIN } });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const agent = await agentNamed(cookie.split("=")[1]!.split(".")[0]!);
  await agent.ensureGreeted();
  return { cookie, agent };
}

async function startFlow(cookie: string): Promise<string> {
  const res = await exports.default.fetch(`${ORIGIN}/auth/google/start`, { headers: { Cookie: cookie }, redirect: "manual" });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location")!);
  expect(loc.hostname).toBe("accounts.google.com");
  expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`);
  return loc.searchParams.get("state")!;
}

function stubGoogle(scope = `openid email ${GMAIL_MODIFY} ${GMAIL_COMPOSE}`) {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.TOPSECRET", scope });
    if (url.startsWith("https://openidconnect.googleapis.com")) return Response.json({ email: "sam@example.com" });
    if (url.includes("/gmail/v1/users/me/messages?")) return Response.json({ messages: [{ id: "m0" }], resultSizeEstimate: 12 });
    if (url.includes("/gmail/v1/users/me/messages/")) return Response.json({ payload: { headers: [{ name: "From", value: "Alice <a@x.com>" }, { name: "Subject", value: "Contract" }] } });
    return real(input as RequestInfo, init);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("gmail routes", () => {
  it("requires a session to start", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/auth/google/start`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });

  it("connects, stores only the snapshot and insight, and rejects replays", async () => {
    const { cookie, agent } = await session();
    const state = await startFlow(cookie);
    stubGoogle();
    const cb = await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(cb.status).toBe(200);
    expect(await cb.text()).toContain("persona-gmail");
    const s = await agent.snapshot();
    expect(s.gmail).toMatchObject({ status: "connected", email: "sam@example.com", snapshot: { unreadCount: 12 } });
    expect(JSON.stringify(s)).not.toContain("ya29");
    expect(s.messages.some((m) => m.data?.card === "insight")).toBe(true);
    const replay = await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(replay.status).toBe(400);
  });

  it("connects without inbox access when the gmail scope is unchecked", async () => {
    const { cookie, agent } = await session();
    const state = await startFlow(cookie);
    stubGoogle("openid email");
    await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect((await agent.snapshot()).gmail).toEqual({ status: "connected_limited", email: "sam@example.com" });
  });

  it("records a declined consent", async () => {
    const { cookie, agent } = await session();
    const state = await startFlow(cookie);
    const cb = await exports.default.fetch(`${ORIGIN}/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(cb.status).toBe(200);
    expect((await agent.snapshot()).gmail.status).toBe("declined");
  });

  it("rejects a forged state", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=abc&state=forged.sig`);
    expect(res.status).toBe(400);
  });

  it("still applies a late completion after graduation", async () => {
    const { cookie, agent } = await session();
    const state = await startFlow(cookie);
    await agent.sendMessage("Skip to the app");
    await agent.whenIdle();
    await agent.sendMessage("Skip to the app");
    await agent.whenIdle();
    expect((await agent.snapshot()).graduatedAt).not.toBeNull();
    stubGoogle();
    await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect((await agent.snapshot()).gmail.status).toBe("connected");
  });
});

describe("gmail callback session binding", () => {
  it("refuses to complete a flow started by a different session (login CSRF / data capture)", async () => {
    const attacker = await session();
    const victim = await session();
    const state = await startFlow(attacker.cookie);
    stubGoogle();
    const res = await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=victim-code&state=${encodeURIComponent(state)}`, { headers: { Cookie: victim.cookie } });
    expect(res.status).toBe(403);
    expect((await attacker.agent.snapshot()).gmail.status).not.toBe("connected");
  });
  it("refuses a callback without a session cookie", async () => {
    const { cookie } = await session();
    const state = await startFlow(cookie);
    const res = await exports.default.fetch(`${ORIGIN}/auth/google/callback?code=x&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(403);
  });
});
