import { describe, expect, it } from "vitest";
import { parseLiveEvent } from "../../src/worker/live/events";

const j = (o: unknown) => JSON.stringify(o);

describe("parseLiveEvent", () => {
  it("parses lifecycle events", () => {
    expect(parseLiveEvent(j({ type: "session.started", session: { id: "live_1" } }))).toEqual({ kind: "started" });
    expect(parseLiveEvent(j({ type: "session.usage.updated", usage: { seconds: 15.0 } }))).toEqual({ kind: "usage", seconds: 15 });
    expect(parseLiveEvent(j({ type: "session.closed", reason: "remote_hangup", session: {} }))).toEqual({ kind: "closed", reason: "remote_hangup" });
  });
  it("parses transcripts from both speakers", () => {
    expect(parseLiveEvent(j({ type: "session.input_transcript.delta", delta: "Mostly", start_ms: 10, end_ms: 20 }))).toEqual({ kind: "transcript", speaker: "user", delta: "Mostly" });
    expect(parseLiveEvent(j({ type: "session.output_transcript.delta", delta: " What", start_ms: 1, end_ms: 2 }))).toEqual({ kind: "transcript", speaker: "assistant", delta: " What" });
  });
  it("parses completed function calls inside response.event", () => {
    const raw = j({
      type: "response.event",
      delegation_id: "item_1",
      event: { type: "response.output_item.done", item: { type: "function_call", call_id: "call_8", name: "set_help_goal", arguments: "{\"goal\":\"email\"}", status: "completed" } },
    });
    expect(parseLiveEvent(raw)).toEqual({ kind: "function_call", callId: "call_8", name: "set_help_goal", argsJson: "{\"goal\":\"email\"}" });
  });
  it("ignores nested non-call events and unknown events", () => {
    expect(parseLiveEvent(j({ type: "response.event", delegation_id: "x", event: { type: "response.output_text.delta", delta: "hi" } }))).toEqual({ kind: "ignored" });
    expect(parseLiveEvent(j({ type: "response.event", event: { type: "response.output_item.done", item: { type: "message" } } }))).toEqual({ kind: "ignored" });
    expect(parseLiveEvent(j({ type: "something.new", x: 1 }))).toEqual({ kind: "ignored" });
  });
  it("parses errors", () => {
    expect(parseLiveEvent(j({ type: "error", error: { code: "invalid_request", message: "bad" } }))).toEqual({ kind: "error", code: "invalid_request", message: "bad" });
  });
  it("survives garbage", () => {
    expect(parseLiveEvent("not json")).toEqual({ kind: "ignored" });
    expect(parseLiveEvent(j({ type: "session.usage.updated", usage: { seconds: "x" } }))).toEqual({ kind: "ignored" });
  });
});
