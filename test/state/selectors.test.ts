import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/worker/state/initial";
import { missingSlots, nextGoal, phaseOf, quickReplies, summaryForPrompt } from "../../src/worker/state/selectors";
import type { SessionState } from "../../src/shared/types";
import { NOW, filled, stateWith } from "./fixtures";

const slots = (p: Partial<SessionState["slots"]>) => ({ ...createInitialState(NOW).slots, ...p });
const connected = { status: "connected" as const, email: "sam@x.com", snapshot: { unreadCount: 3, topSenders: [], sampleSubjects: [] }, insight: "i" };

describe("missingSlots", () => {
  it("lists everything on a fresh session in canonical order", () => {
    expect(missingSlots(createInitialState(NOW))).toEqual(["agentName", "userName", "helpGoal", "gmail"]);
  });
  it("treats pending confirmation as missing and defaulted as present", () => {
    const s = stateWith({ slots: slots({ agentName: { status: "defaulted", value: "Persona" }, userName: { status: "pending_confirmation", value: "Batman", source: "voice" } }) });
    expect(missingSlots(s)).toEqual(["userName", "helpGoal", "gmail"]);
  });
  it("treats limited gmail as connected", () => {
    const s = stateWith({ gmail: { status: "connected_limited", email: "a@b.c" } });
    expect(missingSlots(s)).not.toContain("gmail");
  });
});

describe("nextGoal", () => {
  it("asks to name the agent first", () => {
    expect(nextGoal(createInitialState(NOW))).toBe("name_agent");
  });
  it("offers the call once the agent is named", () => {
    expect(nextGoal(stateWith({ slots: slots({ agentName: filled("Jarvis") }) }))).toBe("offer_call");
  });
  it("is on_call while ringing or active", () => {
    const base = { slots: slots({ agentName: filled("Jarvis") }) };
    expect(nextGoal(stateWith({ ...base, call: { status: "ringing", callId: "c", since: NOW } }))).toBe("on_call");
    expect(nextGoal(stateWith({ ...base, call: { status: "active", callId: "c", liveSessionId: "l", since: NOW, usedSeconds: 0 } }))).toBe("on_call");
  });
  it("after a call attempt, targets the first missing slot", () => {
    const s = stateWith({ callAttempts: 1, slots: slots({ agentName: filled("Jarvis") }) });
    expect(nextGoal(s)).toBe("user_name");
  });
  it("when the user led with their goal, asks for the name next", () => {
    const s = stateWith({ callAttempts: 1, slots: slots({ agentName: filled("Jarvis"), helpGoal: filled("email") }) });
    expect(nextGoal(s)).toBe("user_name");
  });
  it("asks to confirm a pending name", () => {
    const s = stateWith({ callAttempts: 1, slots: slots({ agentName: filled("J"), userName: { status: "pending_confirmation", value: "Batman", source: "text" } }) });
    expect(nextGoal(s)).toBe("confirm_user_name");
  });
  it("skips parked slots", () => {
    const s = stateWith({ callAttempts: 1, slots: slots({ agentName: filled("J"), userName: { status: "parked", attempts: 2 } }) });
    expect(nextGoal(s)).toBe("help_goal");
  });
  it("goes to gmail, then wrap up, then done", () => {
    const named = slots({ agentName: filled("J"), userName: filled("Sam"), helpGoal: filled("email") });
    expect(nextGoal(stateWith({ callAttempts: 1, slots: named }))).toBe("gmail");
    expect(nextGoal(stateWith({ callAttempts: 1, slots: named, gmail: connected }))).toBe("wrap_up");
    expect(nextGoal(stateWith({ slots: named, graduatedAt: NOW }))).toBe("done");
  });
});

describe("phaseOf", () => {
  it("derives phases", () => {
    expect(phaseOf(createInitialState(NOW))).toBe("naming");
    expect(phaseOf(stateWith({ slots: slots({ agentName: filled("J") }), call: { status: "ringing", callId: "c", since: NOW } }))).toBe("calling");
    expect(phaseOf(stateWith({ callAttempts: 1, slots: slots({ agentName: filled("J") }) }))).toBe("collecting_text");
    expect(phaseOf(stateWith({ graduatedAt: NOW }))).toBe("graduated");
  });
});

describe("quickReplies", () => {
  it("suggests names while naming", () => {
    expect(quickReplies(createInitialState(NOW))).toEqual(["Jarvis", "Friday", "You pick"]);
  });
  it("offers the call", () => {
    expect(quickReplies(stateWith({ slots: slots({ agentName: filled("J") }) }))).toEqual(["Call me", "Let's just text", "Skip to the app"]);
  });
  it("offers a call back after a failed call", () => {
    const s = stateWith({ callAttempts: 1, slots: slots({ agentName: filled("J") }), call: { status: "ended", callId: "c", reason: "dropped", at: NOW, durationMs: 1000 } });
    expect(quickReplies(s)).toEqual(["Call me back", "Text is fine", "Skip to the app"]);
  });
  it("shows nothing while ringing, mid-turn, or graduated", () => {
    const named = slots({ agentName: filled("J") });
    expect(quickReplies(stateWith({ slots: named, call: { status: "ringing", callId: "c", since: NOW } }))).toEqual([]);
    expect(quickReplies(stateWith({ slots: named, turnPending: true }))).toEqual([]);
    expect(quickReplies(stateWith({ graduatedAt: NOW }))).toEqual([]);
  });
  it("offers gmail and graduation near the end", () => {
    const named = slots({ agentName: filled("J"), userName: filled("Sam"), helpGoal: filled("email") });
    expect(quickReplies(stateWith({ callAttempts: 1, slots: named }))).toEqual(["Connect Gmail", "Skip for now"]);
    expect(quickReplies(stateWith({ callAttempts: 1, slots: named, gmail: connected }))).toEqual(["Take me to the app"]);
  });
});

describe("summaryForPrompt", () => {
  it("states known and missing facts", () => {
    const s = stateWith({ slots: slots({ agentName: filled("Jarvis"), helpGoal: filled("email triage") }) });
    const text = summaryForPrompt(s);
    expect(text).toContain("Assistant name: Jarvis");
    expect(text).toContain("Help goal: email triage");
    expect(text).toContain("User name: unknown");
    expect(text).toContain("Gmail: not connected");
  });
});
