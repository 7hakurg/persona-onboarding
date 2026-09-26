import { describe, expect, it } from "vitest";
import { validateAgentName, validateHelpGoal, validateUserName } from "../../src/worker/conductor/slots";

describe("validateUserName", () => {
  it.each([
    ["Sam", "Sam"],
    ["my name is Sam", "Sam"],
    ["call me sam", "Sam"],
    ["I'm alex.", "Alex"],
    ["it's Priya", "Priya"],
    ["Mary-Jane O'Neil", "Mary-Jane O'Neil"],
    ["  José  ", "José"],
    ["dr. who", "Dr. Who"],
  ])("accepts %j as %j", (raw, value) => {
    const r = validateUserName(raw);
    expect(r).toMatchObject({ ok: true, value, needsConfirmation: false });
  });

  it.each([
    ["Robert'); DROP TABLE", "invalid_characters"],
    ["12345", "invalid_characters"],
    ["https://x.co", "invalid_characters"],
    ["sam@example.com", "invalid_characters"],
    ["", "empty"],
    ["   ", "empty"],
    ["my name is", "empty"],
    ["A".repeat(41), "too_long"],
  ])("rejects %j with %s", (raw, reason) => {
    expect(validateUserName(raw)).toEqual({ ok: false, reason });
  });

  it.each(["Sir Poops-a-lot", "Batman", "Your Mom", "Lord Voldemort Supreme Leader", "xxx"])(
    "accepts %j but asks for confirmation",
    (raw) => {
      expect(validateUserName(raw)).toMatchObject({ ok: true, needsConfirmation: true });
    },
  );
});

describe("validateAgentName", () => {
  it("accepts playful names", () => {
    expect(validateAgentName("Jarvis 2.0")).toEqual({ ok: true, value: "Jarvis 2.0", needsConfirmation: false });
    expect(validateAgentName("call yourself Friday")).toMatchObject({ ok: true, value: "Friday" });
    expect(validateAgentName("🤖 Robo")).toMatchObject({ ok: true, value: "🤖 Robo" });
  });
  it("rejects URLs, empties and very long names", () => {
    expect(validateAgentName("www.evil.com")).toEqual({ ok: false, reason: "invalid_characters" });
    expect(validateAgentName("  ")).toEqual({ ok: false, reason: "empty" });
    expect(validateAgentName("x".repeat(31))).toEqual({ ok: false, reason: "too_long" });
    expect(validateAgentName("<script>")).toEqual({ ok: false, reason: "invalid_characters" });
  });
});

describe("validateHelpGoal", () => {
  it("accepts short goals", () => {
    expect(validateHelpGoal(" email ")).toEqual({ ok: true, value: "email" });
  });
  it("rejects one-character goals", () => {
    expect(validateHelpGoal("a")).toEqual({ ok: false, reason: "too_short" });
  });
  it("truncates very long goals", () => {
    const r = validateHelpGoal("x".repeat(600));
    expect(r.ok && r.value.length).toBe(500);
  });
  it("strips control characters and angle brackets", () => {
    expect(validateHelpGoal("plan <b>trips</b>\u0000")).toEqual({ ok: true, value: "plan btrips/b" });
  });
});

describe("joke detection avoids false positives", () => {
  it.each(["Godfrey", "Celeste", "Santana", "Nobuko"])("does not flag %j", (raw) => {
    expect(validateUserName(raw)).toMatchObject({ ok: true, needsConfirmation: false });
  });
});

describe("agent name casing", () => {
  it("capitalizes all-lowercase names but keeps deliberate casing", () => {
    expect(validateAgentName("jarvis")).toMatchObject({ ok: true, value: "Jarvis" });
    expect(validateAgentName("mr robot")).toMatchObject({ ok: true, value: "Mr Robot" });
    expect(validateAgentName("HAL")).toMatchObject({ ok: true, value: "HAL" });
    expect(validateAgentName("deGrasse")).toMatchObject({ ok: true, value: "deGrasse" });
  });
});
