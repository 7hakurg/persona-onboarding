import { errorFields, log } from "../log";

/**
 * Debounced, coalescing runner: bursts of requests become one run, and requests
 * that arrive while a run is in flight trigger exactly one follow-up run.
 */
export class TurnQueue {
  private running: Promise<void> | null = null;
  private dirty = false;
  private runs = 0;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly debounceMs: number,
  ) {}

  request(): void {
    this.dirty = true;
    if (!this.running) this.running = this.drain();
  }

  get count(): number {
    return this.runs;
  }

  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.debounceMs));
    try {
      while (this.dirty) {
        this.dirty = false;
        this.runs += 1;
        try {
          await this.run();
        } catch (err) {
          log("error", "turn_failed", errorFields(err));
        }
      }
    } finally {
      this.running = null;
    }
  }
}
