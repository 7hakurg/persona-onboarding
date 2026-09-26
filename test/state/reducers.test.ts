import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/worker/state/initial";
import {
  appendEvent,
  appendMessage,
  beginCallAttempt,
  graduate,
  markNudge,
  recordInvalidAttempt,
  setCall,
  setGmail,
  setSlot,
  setTurnPending,
} from "../../src/worker/state/reducers";
import { CONFIG } from "../../src/worker/config";
import { NOW, deepFreeze, filled, stateWith } from "./fixtures";

const msg = (id: string) => ({ id, at: NOW, role: "user" as const, kind: "text" as const, text: id });

describe("createInitialState", () => {
  it("starts empty, not graduated, idle call", () => {
    const s = createInitialState(NOW);
    expect(s.version).toBe(1);
    expect(s.slots.agentName).toEqual({ status: "empty" });
    expect(s.slots.userName).toEqual({ status: "empty" });
    expect(s.slots.helpGoal).toEqual({ status: "empty" });
    expect(s.gmail).toEqual({ status: "not_connected" });
    expect(s.call).toEqual({ status: "idle" });
    expect(s.graduatedAt).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.callAttempts).toBe(0);
    expect(s.createdAt).toBe(NOW);
  });
});

describe("reducers are pure", () => {
  it("never mutate their input", () => {
    const base = deepFreeze(createInitialState(NOW));
    expect(() => appendMessage(base, msg("a"))).not.toThrow();
    expect(() => appendEvent(base, { at: NOW, type: "x", detail: "y" })).not.toThrow();
    expect(() => setSlot(base, "userName", filled("Sam"))).not.toThrow();
    expect(() => setGmail(base, { status: "declined", at: NOW })).not.toThrow();
    expect(() => setCall(base, { status: "ringing", callId: "c1", since: NOW })).not.toThrow();
    expect(() => markNudge(base, "gmailBeforeGraduate")).not.toThrow();
    expect(() => recordInvalidAttempt(base, "userName")).not.toThrow();
    expect(() => graduate(base, NOW)).not.toThrow();
    expect(() => setTurnPending(base, true)).not.toThrow();
    expect(() => beginCallAttempt(base)).not.toThrow();
  });

  it("return new objects", () => {
    const base = createInitialState(NOW);
    const next = setSlot(base, "userName", filled("Sam"));
    expect(next).not.toBe(base);
    expect(next.slots.userName).toEqual(filled("Sam"));
    expect(base.slots.userName).toEqual({ status: "empty" });
  });
});

describe("history caps", () => {
  it("drops the oldest messages past the cap", () => {
    let s = createInitialState(NOW);
    for (let i = 0; i < CONFIG.history.maxMessages + 5; i++) s = appendMessage(s, msg(`m${i}`));
    expect(s.messages).toHaveLength(CONFIG.history.maxMessages);
    expect(s.messages[0]?.id).toBe("m5");
  });

  it("drops the oldest events past the cap", () => {
    let s = createInitialState(NOW);
    for (let i = 0; i < CONFIG.history.maxEvents + 3; i++) s = appendEvent(s, { at: NOW, type: `e${i}`, detail: "" });
    expect(s.events).toHaveLength(CONFIG.history.maxEvents);
    expect(s.events[0]?.type).toBe("e3");
  });
});

describe("recordInvalidAttempt", () => {
  it("parks a slot after the maximum attempts", () => {
    let s = createInitialState(NOW);
    for (let i = 0; i < CONFIG.limits.maxSlotAttempts; i++) s = recordInvalidAttempt(s, "userName");
    expect(s.slots.userName).toEqual({ status: "parked", attempts: CONFIG.limits.maxSlotAttempts });
  });

  it("does not park a filled slot", () => {
    let s = stateWith({ slots: { ...createInitialState(NOW).slots, userName: filled("Sam") } });
    for (let i = 0; i < 5; i++) s = recordInvalidAttempt(s, "userName");
    expect(s.slots.userName).toEqual(filled("Sam"));
  });
});

describe("graduate", () => {
  it("defaults the agent name and keeps filled slots", () => {
    const base = stateWith({ slots: { ...createInitialState(NOW).slots, helpGoal: filled("email") } });
    const s = graduate(base, NOW + 5);
    expect(s.graduatedAt).toBe(NOW + 5);
    expect(s.slots.agentName).toEqual({ status: "defaulted", value: "Persona" });
    expect(s.slots.helpGoal).toEqual(filled("email"));
    expect(s.slots.userName).toEqual({ status: "empty" });
  });

  it("is idempotent", () => {
    const once = graduate(createInitialState(NOW), NOW + 5);
    expect(graduate(once, NOW + 99).graduatedAt).toBe(NOW + 5);
  });
});

describe("beginCallAttempt", () => {
  it("counts call attempts", () => {
    expect(beginCallAttempt(beginCallAttempt(createInitialState(NOW))).callAttempts).toBe(2);
  });
});
