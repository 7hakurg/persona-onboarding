import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import "../../src/worker/index";
import { freshAgent } from "./helpers";

const OFFER = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

describe("OnboardingAgent call path", () => {
  it("rings on request and refuses a second ring", async () => {
    const agent = await freshAgent();
    expect(await agent.requestCall()).toEqual({ ok: true });
    expect((await agent.snapshot()).call.status).toBe("ringing");
    expect(await agent.requestCall()).toEqual({ ok: false, error: "call_in_progress" });
  });

  it("declines, posts a missed-call card and follows up", async () => {
    const agent = await freshAgent();
    await agent.requestCall();
    expect(await agent.declineCall()).toEqual({ ok: true });
    const s = await agent.snapshot();
    expect(s.call).toMatchObject({ status: "ended", reason: "declined" });
    expect(s.messages.some((m) => m.data?.card === "call")).toBe(true);
    expect(s.messages.at(-1)?.role).toBe("assistant");
  });

  it("falls back to text when the live session cannot be created", async () => {
    const agent = await freshAgent();
    await agent.requestCall();
    expect(await agent.acceptCall(OFFER)).toEqual({ ok: false, error: "unavailable" });
    expect((await agent.snapshot()).call).toMatchObject({ status: "ended", reason: "connection_failed" });
  });

  it("only accepts client end reasons it knows", async () => {
    const agent = await freshAgent();
    await agent.requestCall();
    expect(await agent.endCall("completed")).toEqual({ ok: false, error: "invalid" });
    expect(await agent.endCall("mic_denied")).toEqual({ ok: true });
    expect((await agent.snapshot()).call).toMatchObject({ status: "ended", reason: "mic_denied" });
  });

  it("ends the call from the page-close beacon", async () => {
    const origin = "https://persona.test";
    const res = await exports.default.fetch(`${origin}/api/session`, { method: "POST", headers: { Origin: origin } });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    const sid = cookie.split("=")[1]!;
    const { agentNamed } = await import("./helpers");
    const agent = await agentNamed(sid);
    await agent.ensureGreeted();
    await agent.requestCall();
    const beacon = await exports.default.fetch(`${origin}/api/call-ended`, { method: "POST", headers: { Cookie: cookie } });
    expect(beacon.status).toBe(204);
    expect((await agent.snapshot()).call).toMatchObject({ status: "ended", reason: "page_closed" });
  });
});
