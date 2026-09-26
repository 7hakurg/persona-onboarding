import type { TranscriptLine } from "../../shared/types";

const DEFAULT_MAX_CHARS = 8_000;

function joinDelta(prev: string, delta: string): string {
  if (prev === "") return delta.trimStart();
  if (/^\s/.test(delta) || /\s$/.test(prev) || /^[.,!?;:'’)]/.test(delta)) return prev + delta;
  return `${prev} ${delta}`;
}

/** Groups streaming transcript deltas into speaker turns. */
export class TranscriptBuffer {
  private readonly entries: TranscriptLine[] = [];
  private size = 0;

  constructor(private readonly maxChars = DEFAULT_MAX_CHARS) {}

  add(speaker: TranscriptLine["speaker"], delta: string): void {
    if (delta === "" || this.size >= this.maxChars) return;
    const last = this.entries.at(-1);
    if (last && last.speaker === speaker) {
      const text = joinDelta(last.text, delta);
      this.size += text.length - last.text.length;
      this.entries[this.entries.length - 1] = { speaker, text };
    } else {
      const text = delta.trim();
      if (text === "") return;
      this.entries.push({ speaker, text });
      this.size += text.length;
    }
  }

  lines(): TranscriptLine[] {
    return this.entries.map((l) => ({ ...l, text: l.text.trim() }));
  }

  hasUserSpeech(): boolean {
    return this.entries.some((l) => l.speaker === "user" && l.text.trim() !== "");
  }

  asText(): string {
    return this.lines()
      .map((l) => `${l.speaker === "user" ? "USER" : "ASSISTANT"}: ${l.text}`)
      .join("\n");
  }
}
