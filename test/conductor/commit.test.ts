import { describe, expect, it } from "vitest";
import { commitTurn } from "../../src/worker/conductor/commit";
import { createInitialState } from "../../src/worker/state/initial";
import { appendMessage, setCall, setGmail, setSlot } from "../../src/worker/state/reducers";
import { NOW, filled } from "../state/fixtures";

const reply = { id: "a1", at: NOW, role: "assistant" as const, kind: "text" as const, text: "Got it!" };

describe("commitTurn", () => {
  it("keeps a slot written concurrently (e.g. post-call extraction) while applying the turn's tools", () => {
    const latest = setSlot(createInitialState(NOW), "userName", filled("Sam", "voice"));
    const out = commitTurn(latest, { invocations: [{ name: "set_help_goal", argsJson: "{\"goal\":\"email\"}" }], replies: [reply] }, NOW);
    expect(out.state.slots.userName).toEqual(filled("Sam", "voice"));
    expect(out.state.slots.helpGoal).toMatchObject({ status: "filled", value: "email" });
  });

  it("does not clobber a gmail connection that completed during the turn", () => {
    const latest = setGmail(createInitialState(NOW), { status: "connected_limited", email: "a@b.co" });
    const out = commitTurn(latest, { invocations: [{ name: "send_gmail_link", argsJson: "{}" }], replies: [reply] }, NOW);
    expect(out.state.gmail).toEqual({ status: "connected_limited", email: "a@b.co" });
    expect(out.effects).toEqual([]);
  });

  it("recomputes effects against the latest state", () => {
    const latest = setCall(createInitialState(NOW), { status: "ringing", callId: "c", since: NOW });
    const out = commitTurn(latest, { invocations: [{ name: "start_call", argsJson: "{}" }], replies: [reply] }, NOW);
    expect(out.effects).toEqual([]);
  });

  it("appends replies after messages that arrived during the turn", () => {
    const latest = { ...appendMessage(createInitialState(NOW), { id: "u2", at: NOW, role: "user", kind: "text", text: "wait" }), turnPending: true };
    const out = commitTurn(latest, { invocations: [], replies: [reply] }, NOW);
    expect(out.state.messages.map((m) => m.id)).toEqual(["u2", "a1"]);
  });
});
