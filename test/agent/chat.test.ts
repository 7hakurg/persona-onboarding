import { describe, expect, it } from "vitest";
import { CONFIG } from "../../src/worker/config";
import { GREETING_TEXT } from "../../src/worker/conductor/prompts";
import { freshAgent } from "./helpers";

describe("OnboardingAgent chat path", () => {
  it("greets exactly once", async () => {
    const agent = await freshAgent();
    await agent.ensureGreeted();
    const s = await agent.snapshot();
    expect(s.messages.filter((m) => m.text === GREETING_TEXT)).toHaveLength(1);
  });

  it("stores the user message and replies", async () => {
    const agent = await freshAgent();
    expect(await agent.sendMessage("Friday")).toEqual({ ok: true });
    await agent.whenIdle();
    const s = await agent.snapshot();
    expect(s.slots.agentName).toMatchObject({ status: "filled", value: "Friday" });
    expect(s.messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect(s.turnPending).toBe(false);
  });

  it("coalesces rapid-fire messages into one turn", async () => {
    const agent = await freshAgent();
    await Promise.all(["call yourself Jarvis", "wait", "actually", "hmm", "ok"].map((t) => agent.sendMessage(t)));
    await agent.whenIdle();
    expect(await agent.turnCount()).toBe(1);
    const s = await agent.snapshot();
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(5);
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("rejects empty and oversized messages", async () => {
    const agent = await freshAgent();
    expect(await agent.sendMessage("   ")).toEqual({ ok: false, error: "empty" });
    expect(await agent.sendMessage("x".repeat(CONFIG.limits.maxMessageChars + 1))).toEqual({ ok: false, error: "too_long" });
    expect((await agent.snapshot()).messages).toHaveLength(1);
  });

  it("rate limits chat messages", async () => {
    const agent = await freshAgent();
    for (let i = 0; i < CONFIG.limits.chatMessagesPerWindow; i++) await agent.sendMessage(`m${i}`);
    expect(await agent.sendMessage("one too many")).toEqual({ ok: false, error: "rate_limited" });
    await agent.whenIdle();
  });

  it("runs effects: ringing after the user agrees to a call", async () => {
    const agent = await freshAgent();
    await agent.sendMessage("Friday");
    await agent.whenIdle();
    await agent.sendMessage("Call me");
    await agent.whenIdle();
    const s = await agent.snapshot();
    expect(s.call.status).toBe("ringing");
    expect(s.callAttempts).toBe(1);
  });

  it("posts a gmail card when the model sends the link", async () => {
    const agent = await freshAgent();
    await agent.sendMessage("Connect Gmail");
    await agent.whenIdle();
    const s = await agent.snapshot();
    expect(s.messages.some((m) => m.data?.card === "gmail")).toBe(true);
  });

  it("graduates after one nudge", async () => {
    const agent = await freshAgent();
    await agent.sendMessage("Skip to the app");
    await agent.whenIdle();
    expect((await agent.snapshot()).graduatedAt).toBeNull();
    await agent.sendMessage("Skip to the app");
    await agent.whenIdle();
    const s = await agent.snapshot();
    expect(s.graduatedAt).not.toBeNull();
    expect(await agent.sendMessage("hi again")).toEqual({ ok: true });
  });

  it("rejects state writes from clients", async () => {
    const agent = await freshAgent();
    await expect(agent.tryClientStateWrite()).resolves.toBe("rejected");
  });

  it("sends at most one idle nudge", async () => {
    const agent = await freshAgent();
    await agent.idleCheck({ lastActivityAt: 0 });
    await agent.idleCheck({ lastActivityAt: 0 });
    const nudges = (await agent.snapshot()).messages.filter((m) => m.role === "assistant");
    expect(nudges).toHaveLength(2);
  });
});

describe("OnboardingAgent persistence", () => {
  it("restores the same session state for the same name (refresh / reconnect)", async () => {
    const { agentNamed } = await import("./helpers");
    const name = `persist-${Date.now()}`;
    const first = await agentNamed(name);
    await first.ensureGreeted();
    await first.sendMessage("Friday");
    await first.whenIdle();
    const again = await agentNamed(name);
    await again.ensureGreeted();
    const s = await again.snapshot();
    expect(s.slots.agentName).toMatchObject({ value: "Friday" });
    expect(s.messages.filter((m) => m.role === "assistant" && m.text.startsWith("Hey!"))).toHaveLength(1);
  });
});
