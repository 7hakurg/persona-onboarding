import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/worker/state/initial";
import { appendEvent, appendMessage, setCall, setSlot } from "../../src/worker/state/reducers";
import { mergeTurnResult } from "../../src/worker/state/merge";
import { NOW, filled } from "./fixtures";

const msg = (id: string, role: "user" | "assistant" = "user") => ({ id, at: NOW, role, kind: "text" as const, text: id });

describe("mergeTurnResult", () => {
  it("keeps messages that arrived while the turn was running", () => {
    const before = appendMessage(createInitialState(NOW), msg("u1"));
    const latest = appendMessage(before, msg("u2"));
    const after = setSlot(appendMessage(before, msg("a1", "assistant")), "agentName", filled("Jarvis"));
    const merged = mergeTurnResult(latest, before, after);
    expect(merged.messages.map((m) => m.id)).toEqual(["u1", "u2", "a1"]);
    expect(merged.slots.agentName).toEqual(filled("Jarvis"));
  });

  it("keeps concurrent changes to fields the turn did not touch", () => {
    const before = createInitialState(NOW);
    const latest = setCall(before, { status: "ringing", callId: "c", since: NOW });
    const after = setSlot(before, "userName", filled("Sam"));
    const merged = mergeTurnResult(latest, before, after);
    expect(merged.call.status).toBe("ringing");
    expect(merged.slots.userName).toEqual(filled("Sam"));
  });

  it("appends new events from both sides", () => {
    const before = createInitialState(NOW);
    const latest = appendEvent(before, { at: NOW, type: "call", detail: "" });
    const after = appendEvent(before, { at: NOW, type: "tool", detail: "" });
    expect(mergeTurnResult(latest, before, after).events.map((e) => e.type)).toEqual(["call", "tool"]);
  });
});
