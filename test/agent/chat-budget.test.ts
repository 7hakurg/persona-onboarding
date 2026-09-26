import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CONFIG } from "../../src/worker/config";
import { CHAT_BUSY_REPLY } from "../../src/worker/conductor/prompts";
import { GLOBAL_BUDGET_NAME } from "../../src/worker/limits/budget";
import { freshAgent } from "./helpers";

describe("global chat budget", () => {
  it("answers without calling the model once the daily chat budget is spent", async () => {
    const budget = env.BUDGET.get(env.BUDGET.idFromName(GLOBAL_BUDGET_NAME));
    await runInDurableObject(budget, async (_instance, state) => {
      await state.storage.put(`chat-turns:${new Date().toISOString().slice(0, 10)}`, CONFIG.limits.dailyChatTurns);
    });
    const agent = await freshAgent();
    await agent.sendMessage("call yourself Nova");
    await agent.whenIdle();
    const s = await agent.snapshot();
    expect(s.messages.at(-1)?.text).toBe(CHAT_BUSY_REPLY);
    expect(s.slots.agentName.status).toBe("empty");
    expect(s.turnPending).toBe(false);
  });
});
