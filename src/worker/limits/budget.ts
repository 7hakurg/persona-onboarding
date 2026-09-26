import { DurableObject } from "cloudflare:workers";
import { CONFIG } from "../config";
import type { Env } from "../env";

/** Global (singleton-by-name) daily voice-minute budget. */
export class BudgetDO extends DurableObject<Env> {
  private key(now = Date.now()): string {
    return `voice-seconds:${new Date(now).toISOString().slice(0, 10)}`;
  }

  async usedSecondsToday(): Promise<number> {
    return (await this.ctx.storage.get<number>(this.key())) ?? 0;
  }

  async hasCapacity(): Promise<boolean> {
    return (await this.usedSecondsToday()) < CONFIG.limits.dailyVoiceMinutes * 60;
  }

  async record(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const key = this.key();
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    await this.ctx.storage.put(key, used + seconds);
  }
}

export const GLOBAL_BUDGET_NAME = "global";
