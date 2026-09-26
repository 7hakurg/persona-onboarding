import { describe, expect, it } from "vitest";
import { executeTool, toolDefinitions } from "../../src/worker/conductor/tools";
import { createInitialState } from "../../src/worker/state/initial";
import type { SessionState } from "../../src/shared/types";
import { CONFIG } from "../../src/worker/config";
import { NOW, filled, stateWith } from "../state/fixtures";

const run = (state: SessionState, name: string, args: unknown, channel: "text" | "voice" = "text") =>
  executeTool(state, { name, argsJson: JSON.stringify(args), channel, now: NOW });
const slots = (p: Partial<SessionState["slots"]>) => ({ ...createInitialState(NOW).slots, ...p });

describe("toolDefinitions", () => {
  it("exposes start_call only on text and end_call only on voice", () => {
    const text = toolDefinitions("text").map((t) => t.name);
    const voice = toolDefinitions("voice").map((t) => t.name);
    expect(text).toContain("start_call");
    expect(text).not.toContain("end_call");
    expect(voice).toContain("end_call");
    expect(voice).not.toContain("start_call");
  });
  it("uses strict schemas", () => {
    for (const t of toolDefinitions("text")) {
      expect(t.strict).toBe(true);
      expect(t.parameters.additionalProperties).toBe(false);
    }
  });
});

describe("executeTool guards", () => {
  it("rejects tools not allowed on the channel without changing state", () => {
    const s = createInitialState(NOW);
    const out = run(s, "end_call", {}, "text");
    expect(out.result).toMatchObject({ ok: false, error: "not_allowed_on_channel" });
    expect(out.state).toBe(s);
    expect(out.effects).toEqual([]);
  });
  it("rejects unknown tools", () => {
    expect(run(createInitialState(NOW), "rm_rf", {}).result).toMatchObject({ ok: false, error: "unknown_tool" });
  });
  it("rejects malformed arguments", () => {
    const out = executeTool(createInitialState(NOW), { name: "set_user_name", argsJson: "{not json", channel: "text", now: NOW });
    expect(out.result).toMatchObject({ ok: false, error: "invalid_arguments" });
    const out2 = run(createInitialState(NOW), "set_user_name", { name: 42 });
    expect(out2.result).toMatchObject({ ok: false, error: "invalid_arguments" });
  });
});

describe("set_user_name", () => {
  it("fills a valid name and reports what is still missing", () => {
    const out = run(createInitialState(NOW), "set_user_name", { name: "my name is sam", confirmed: false }, "voice");
    expect(out.state.slots.userName).toEqual({ status: "filled", value: "Sam", source: "voice", at: NOW });
    expect(out.result).toMatchObject({ ok: true, saved: { userName: "Sam" } });
    expect(out.result.stillMissing).toEqual(["agentName", "helpGoal", "gmail"]);
    expect(out.state.events.at(-1)?.type).toBe("tool:set_user_name");
  });
  it("puts joke names into pending confirmation, then fills on confirmation", () => {
    const first = run(createInitialState(NOW), "set_user_name", { name: "Batman", confirmed: false });
    expect(first.state.slots.userName).toEqual({ status: "pending_confirmation", value: "Batman", source: "text" });
    expect(first.result).toMatchObject({ ok: true, needsConfirmation: true });
    const second = run(first.state, "set_user_name", { name: "batman", confirmed: true });
    expect(second.state.slots.userName).toMatchObject({ status: "filled", value: "Batman" });
  });
  it("ignores confirmed:true when nothing is pending", () => {
    const out = run(createInitialState(NOW), "set_user_name", { name: "Batman", confirmed: true });
    expect(out.state.slots.userName.status).toBe("pending_confirmation");
  });
  it("parks the slot after repeated invalid names", () => {
    let s = createInitialState(NOW);
    for (let i = 0; i < CONFIG.limits.maxSlotAttempts; i++) {
      const out = run(s, "set_user_name", { name: "12345", confirmed: false });
      expect(out.result).toMatchObject({ ok: false, error: "invalid_name:invalid_characters" });
      s = out.state;
    }
    expect(s.slots.userName.status).toBe("parked");
  });
});

describe("set_agent_name and set_help_goal", () => {
  it("fills the agent name", () => {
    const out = run(createInitialState(NOW), "set_agent_name", { name: "Jarvis" });
    expect(out.state.slots.agentName).toMatchObject({ status: "filled", value: "Jarvis" });
  });
  it("rejects a URL agent name", () => {
    expect(run(createInitialState(NOW), "set_agent_name", { name: "www.x.com" }).result).toMatchObject({ ok: false });
  });
  it("fills the help goal", () => {
    const out = run(createInitialState(NOW), "set_help_goal", { goal: "stop drowning in email" }, "voice");
    expect(out.state.slots.helpGoal).toMatchObject({ status: "filled", value: "stop drowning in email", source: "voice" });
  });
});

describe("send_gmail_link", () => {
  it("marks the link sent and posts a card once", () => {
    const out = run(createInitialState(NOW), "send_gmail_link", {});
    expect(out.state.gmail).toEqual({ status: "link_sent", at: NOW });
    expect(out.effects).toEqual([{ type: "post_gmail_card" }]);
    const again = run(out.state, "send_gmail_link", {});
    expect(again.effects).toEqual([]);
    expect(again.result.ok).toBe(true);
  });
  it("does nothing when already connected", () => {
    const s = stateWith({ gmail: { status: "connected_limited", email: "a@b.co" } });
    const out = run(s, "send_gmail_link", {});
    expect(out.effects).toEqual([]);
    expect(out.state.gmail).toEqual(s.gmail);
  });
  it("re-sends after a decline", () => {
    const s = stateWith({ gmail: { status: "declined", at: NOW } });
    expect(run(s, "send_gmail_link", {}).effects).toEqual([{ type: "post_gmail_card" }]);
  });
});

describe("start_call", () => {
  it("rings when allowed", () => {
    const out = run(stateWith({ slots: slots({ agentName: filled("J") }) }), "start_call", {});
    expect(out.effects).toEqual([{ type: "ring" }]);
  });
  it("refuses while a call is in progress", () => {
    for (const call of [
      { status: "ringing", callId: "c", since: NOW },
      { status: "connecting", callId: "c", since: NOW },
      { status: "active", callId: "c", liveSessionId: "l", since: NOW, usedSeconds: 1 },
    ] as const) {
      const out = run(stateWith({ call }), "start_call", {});
      expect(out.result).toMatchObject({ ok: false, error: "call_in_progress" });
      expect(out.effects).toEqual([]);
    }
  });
  it("refuses after the per-session call limit", () => {
    const out = run(stateWith({ callAttempts: CONFIG.limits.callsPerSession }), "start_call", {});
    expect(out.result).toMatchObject({ ok: false, error: "call_limit" });
  });
});

describe("end_call", () => {
  it("emits an end effect on voice", () => {
    expect(run(createInitialState(NOW), "end_call", {}, "voice").effects).toEqual([{ type: "end_call", reason: "completed" }]);
  });
});

describe("graduate", () => {
  it("nudges once about gmail, then graduates", () => {
    const first = run(createInitialState(NOW), "graduate", {});
    expect(first.result).toMatchObject({ ok: false, error: "nudge_first" });
    expect(first.state.nudges.gmailBeforeGraduate).toBe(true);
    expect(first.state.graduatedAt).toBeNull();
    const second = run(first.state, "graduate", {});
    expect(second.result.ok).toBe(true);
    expect(second.state.graduatedAt).toBe(NOW);
    expect(second.effects).toEqual([{ type: "graduated" }]);
  });
  it("graduates immediately when gmail is connected", () => {
    const out = run(stateWith({ gmail: { status: "connected_limited", email: "a@b.co" } }), "graduate", {});
    expect(out.effects).toEqual([{ type: "graduated" }]);
  });
});
