import { describe, expect, it } from "vitest";
import { CallController } from "../../src/worker/live/call-controller";
import { CONFIG } from "../../src/worker/config";
import { FakeHost, OFFER, settle } from "./fake-host";

async function activeCall() {
  const host = new FakeHost();
  const ctl = new CallController(host);
  await ctl.ring();
  const res = await ctl.accept(OFFER);
  await settle();
  return { host, ctl, res, sb: host.sidebands[0]! };
}

const callId = (host: FakeHost) => (host.state.call.status === "idle" ? "" : host.state.call.callId);

describe("ringing", () => {
  it("rings and schedules a timeout", async () => {
    const host = new FakeHost();
    expect(await new CallController(host).ring()).toEqual({ ok: true });
    expect(host.state.call.status).toBe("ringing");
    expect(host.state.callAttempts).toBe(1);
    expect(host.scheduled).toEqual([{ delayMs: CONFIG.limits.ringTimeoutMs, callback: "onRingTimeout", payload: { callId: callId(host) } }]);
  });
  it("does not ring when the voice budget is exhausted", async () => {
    const host = new FakeHost();
    host.capacity = false;
    expect(await new CallController(host).ring()).toEqual({ ok: false, error: "unavailable" });
    expect(host.state.call.status).toBe("idle");
    expect(host.said.at(-1)?.text).toMatch(/text/i);
  });
  it("times out to no_answer, ignoring stale timers", async () => {
    const host = new FakeHost();
    const ctl = new CallController(host);
    await ctl.ring();
    await ctl.onRingTimeout({ callId: "stale" });
    expect(host.state.call.status).toBe("ringing");
    await ctl.onRingTimeout({ callId: callId(host) });
    expect(host.state.call).toMatchObject({ status: "ended", reason: "no_answer" });
    await settle();
    expect(host.said.some((m) => m.data?.card === "call")).toBe(true);
    expect(host.said.at(-1)?.text).toBe("Follow-up!");
  });
  it("declines", async () => {
    const host = new FakeHost();
    const ctl = new CallController(host);
    await ctl.ring();
    await ctl.decline();
    expect(host.state.call).toMatchObject({ status: "ended", reason: "declined" });
  });
});

describe("accepting", () => {
  it("creates exactly one session when accepted twice concurrently", async () => {
    const host = new FakeHost();
    const ctl = new CallController(host);
    await ctl.ring();
    const [a, b] = await Promise.all([ctl.accept(OFFER), ctl.accept(OFFER)]);
    expect(host.createCalls).toBe(1);
    expect([a, b]).toContainEqual({ ok: true, answerSdp: "ANSWER" });
    expect([a, b]).toContainEqual({ ok: false, error: "call_in_progress" });
    expect(host.state.call).toMatchObject({ status: "active", liveSessionId: "live_1" });
  });
  it("rejects an invalid offer and keeps ringing", async () => {
    const host = new FakeHost();
    const ctl = new CallController(host);
    await ctl.ring();
    expect(await ctl.accept("garbage")).toEqual({ ok: false, error: "invalid" });
    expect(host.state.call.status).toBe("ringing");
  });
  it("rejects accept when nothing is ringing", async () => {
    expect(await new CallController(new FakeHost()).accept(OFFER)).toEqual({ ok: false, error: "no_call" });
  });
  it("attaches the sideband, greets, and schedules the max duration", async () => {
    const { host, sb, res } = await activeCall();
    expect(res).toEqual({ ok: true, answerSdp: "ANSWER" });
    expect(sb.sent[0]).toMatchObject({ type: "session.instructions.append", delegation_id: null });
    expect(host.scheduled.map((s) => s.callback)).toContain("onMaxDuration");
  });
  it("falls back to text when session creation fails", async () => {
    const host = new FakeHost();
    host.createImpl = async () => {
      throw new Error("503");
    };
    const ctl = new CallController(host);
    await ctl.ring();
    expect(await ctl.accept(OFFER)).toEqual({ ok: false, error: "unavailable" });
    expect(host.state.call).toMatchObject({ status: "ended", reason: "connection_failed" });
  });
  it("ends the call after three failed sideband attaches", async () => {
    const host = new FakeHost();
    host.attachFailures = CONFIG.timing.sidebandAttachRetries;
    const ctl = new CallController(host);
    await ctl.ring();
    await ctl.accept(OFFER);
    await settle();
    expect(host.state.call).toMatchObject({ status: "ended", reason: "connection_failed" });
    expect(host.released).toBe(1);
  });
  it("closes a session created after the user already hung up", async () => {
    const host = new FakeHost();
    let resolve!: (v: { sessionId: string; answerSdp: string }) => void;
    host.createImpl = () => new Promise((r) => (resolve = r));
    const ctl = new CallController(host);
    await ctl.ring();
    const pending = ctl.accept(OFFER);
    await settle();
    await ctl.hangup("user_hangup");
    resolve({ sessionId: "live_late", answerSdp: "A" });
    expect(await pending).toEqual({ ok: false, error: "no_call" });
    await settle();
    expect(host.state.call).toMatchObject({ status: "ended", reason: "user_hangup" });
    expect(host.sidebands[0]?.sent).toContainEqual({ type: "session.close" });
  });
});

describe("during the call", () => {
  it("executes delegated tools and returns results in order", async () => {
    const { host, sb } = await activeCall();
    sb.sent = [];
    sb.emit({ kind: "function_call", callId: "call_1", name: "set_user_name", argsJson: "{\"name\":\"Sam\",\"confirmed\":false}" });
    sb.emit({ kind: "function_call", callId: "call_1", name: "set_user_name", argsJson: "{\"name\":\"Sam\",\"confirmed\":false}" });
    expect(host.state.slots.userName).toMatchObject({ status: "filled", value: "Sam", source: "voice" });
    expect(sb.sent.map((c) => c.type)).toEqual(["response.item.create", "response.create", "session.update"]);
    expect(sb.sent[0]).toMatchObject({ item: { type: "function_call_output", call_id: "call_1" } });
  });
  it("posts the gmail card when asked on the call", async () => {
    const { host, sb } = await activeCall();
    sb.emit({ kind: "function_call", callId: "c2", name: "send_gmail_link", argsJson: "{}" });
    expect(host.said.some((m) => m.data?.card === "gmail")).toBe(true);
  });
  it("ignores unknown events and tracks usage", async () => {
    const { host, sb } = await activeCall();
    sb.emit({ kind: "ignored" });
    sb.emit({ kind: "usage", seconds: 42 });
    expect(host.state.call).toMatchObject({ status: "active", usedSeconds: 42 });
  });
  it("pushes external changes into the live call", async () => {
    const { ctl, sb } = await activeCall();
    sb.sent = [];
    ctl.notifyExternalChange("Gmail just connected: 12 unread.");
    expect(sb.sent.map((c) => c.type)).toEqual(["session.thinking.append", "session.update"]);
  });
  it("ends gracefully after end_call once the goodbye window passes", async () => {
    const { host, ctl, sb } = await activeCall();
    sb.emit({ kind: "function_call", callId: "c3", name: "end_call", argsJson: "{}" });
    const goodbye = host.scheduled.find((s) => s.callback === "onGoodbyeTimeout");
    expect(goodbye?.delayMs).toBe(CONFIG.timing.goodbyeGraceMs);
    await ctl.onGoodbyeTimeout(goodbye!.payload);
    expect(host.state.call).toMatchObject({ status: "ended", reason: "completed" });
    expect(sb.sent.at(-1)).toEqual({ type: "session.close" });
  });
});

describe("ending", () => {
  it.each([
    ["remote_hangup", "user_hangup"],
    ["close_requested", "user_hangup"],
    ["connection_lost", "dropped"],
    ["expired", "max_duration"],
    ["content", "moderated"],
    ["mystery", "dropped"],
  ])("maps session.closed %s to %s", async (reason, expected) => {
    const { host, sb } = await activeCall();
    sb.emit({ kind: "closed", reason });
    await settle();
    expect(host.state.call).toMatchObject({ status: "ended", reason: expected });
  });
  it("treats a lost sideband as a dropped call and records usage once", async () => {
    const { host, sb } = await activeCall();
    sb.emit({ kind: "usage", seconds: 30 });
    sb.drop();
    sb.emit({ kind: "closed", reason: "connection_lost" });
    await settle();
    expect(host.state.call).toMatchObject({ status: "ended", reason: "dropped" });
    expect(host.recorded).toEqual([30]);
    expect(host.released).toBe(1);
  });
  it("closes the live session at the max duration", async () => {
    const { host, ctl, sb } = await activeCall();
    await ctl.onMaxDuration({ callId: callId(host) });
    expect(sb.sent.at(-1)).toEqual({ type: "session.close" });
    expect(host.state.call).toMatchObject({ status: "ended", reason: "max_duration" });
  });
  it("recovers facts said before the call dropped and follows up", async () => {
    const { host, sb } = await activeCall();
    sb.emit({ kind: "transcript", speaker: "assistant", delta: " Hi! What should I call you?" });
    sb.emit({ kind: "transcript", speaker: "user", delta: "I'm" });
    sb.emit({ kind: "transcript", speaker: "user", delta: "Sam" });
    host.llmResponses = [{ outputText: "{\"userName\":\"Sam\",\"helpGoal\":\"\"}", calls: [] }, { outputText: "Looks like we got cut off, Sam!", calls: [] }];
    sb.drop();
    await settle();
    expect(host.state.slots.userName).toMatchObject({ status: "filled", value: "Sam", source: "voice" });
    const card = host.said.find((m) => m.data?.card === "call");
    expect(card?.data).toMatchObject({ outcome: "dropped", transcript: [{ speaker: "assistant" }, { speaker: "user", text: "I'm Sam" }] });
    expect(host.said.at(-1)?.text).toBe("Looks like we got cut off, Sam!");
  });
  it("uses a deterministic follow-up when the model fails", async () => {
    const { host, sb } = await activeCall();
    host.llm = () => ({ respond: async () => { throw new Error("down"); } });
    sb.drop();
    await settle();
    expect(host.said.at(-1)?.text).toMatch(/cut off|call/i);
  });
  it("ends an active call left over from a restart as dropped", async () => {
    const { host } = await activeCall();
    const fresh = new (await import("../../src/worker/live/call-controller")).CallController(host);
    await fresh.recoverAfterRestart();
    expect(host.state.call).toMatchObject({ status: "ended", reason: "dropped" });
  });
});
