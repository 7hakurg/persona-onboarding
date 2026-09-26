import { describe, expect, it } from "vitest";
import { buildSessionConfig, createLiveSession, LiveApiError } from "../../src/worker/live/live-api";
import { createInitialState } from "../../src/worker/state/initial";
import { appendMessage } from "../../src/worker/state/reducers";
import { NOW, filled, stateWith } from "../state/fixtures";

const state = appendMessage(
  stateWith({ slots: { ...createInitialState(NOW).slots, agentName: filled("Jarvis") } }),
  { id: "1", at: NOW, role: "user", kind: "text", text: "call yourself Jarvis" },
);

describe("buildSessionConfig", () => {
  it("configures gpt-live with Responses delegation and voice tools", () => {
    const cfg = buildSessionConfig(state);
    expect(cfg.model).toBe("gpt-live-1");
    expect(cfg.audio).toEqual({ output: { voice: "marin" } });
    expect(cfg.delegation.type).toBe("responses");
    expect(cfg.delegation.responses.model).toBe("gpt-6-luna");
    const names = cfg.delegation.responses.tools.map((t) => t.name);
    expect(names).toContain("end_call");
    expect(names).not.toContain("start_call");
    expect(cfg.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "call yourself Jarvis" }] }]);
  });
});

describe("createLiveSession", () => {
  it("posts the SDP offer and returns the answer", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ session: { id: "live_9" }, transport: { type: "webrtc", sdp: "ANSWER" } }), { status: 201 });
    }) as unknown as typeof fetch;
    const out = await createLiveSession({ apiKey: "k", sdp: "OFFER", state, fetchImpl });
    expect(out).toEqual({ sessionId: "live_9", answerSdp: "ANSWER" });
    expect(body.transport).toEqual({ type: "webrtc", sdp: "OFFER" });
  });
  it("throws LiveApiError on failure", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    await expect(createLiveSession({ apiKey: "k", sdp: "x", state, fetchImpl })).rejects.toBeInstanceOf(LiveApiError);
  });
  it("rejects malformed success payloads", async () => {
    const fetchImpl = (async () => new Response("{\"session\":{}}", { status: 201 })) as unknown as typeof fetch;
    await expect(createLiveSession({ apiKey: "k", sdp: "x", state, fetchImpl })).rejects.toBeInstanceOf(LiveApiError);
  });
});
