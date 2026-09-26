import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CONFIG } from "../../src/worker/config";
import type { BudgetDO } from "../../src/worker/limits/budget";

const budget = (name: string) => env.BUDGET.get(env.BUDGET.idFromName(name)) as unknown as DurableObjectStub<BudgetDO>;

describe("BudgetDO", () => {
  it("has capacity until the daily voice minutes are used", async () => {
    const b = budget(`t-${Date.now()}`);
    expect(await b.hasCapacity()).toBe(true);
    await b.record(CONFIG.limits.dailyVoiceMinutes * 60 - 1);
    expect(await b.hasCapacity()).toBe(true);
    await b.record(1);
    expect(await b.hasCapacity()).toBe(false);
  });
  it("ignores invalid amounts", async () => {
    const b = budget(`t2-${Date.now()}`);
    await b.record(-5);
    await b.record(Number.NaN);
    expect(await b.usedSecondsToday()).toBe(0);
  });
});
