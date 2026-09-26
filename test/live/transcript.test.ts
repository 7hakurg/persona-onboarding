import { describe, expect, it } from "vitest";
import { TranscriptBuffer } from "../../src/worker/live/transcript";

describe("TranscriptBuffer", () => {
  it("joins word deltas without spaces and keeps pre-spaced deltas", () => {
    const t = new TranscriptBuffer();
    for (const d of ["Mostly", "I", "want", "help", "."]) t.add("user", d);
    for (const d of [" Sure", ",", " I", " can", " help."]) t.add("assistant", d);
    expect(t.lines()).toEqual([
      { speaker: "user", text: "Mostly I want help." },
      { speaker: "assistant", text: "Sure, I can help." },
    ]);
  });
  it("starts a new line when the speaker changes back", () => {
    const t = new TranscriptBuffer();
    t.add("user", "Hi");
    t.add("assistant", " Hello");
    t.add("user", "I'm");
    t.add("user", "Sam");
    expect(t.lines().map((l) => l.text)).toEqual(["Hi", "Hello", "I'm Sam"]);
    expect(t.asText()).toBe("USER: Hi\nASSISTANT: Hello\nUSER: I'm Sam");
    expect(t.hasUserSpeech()).toBe(true);
  });
  it("caps stored text", () => {
    const t = new TranscriptBuffer(50);
    for (let i = 0; i < 100; i++) t.add("user", "word");
    expect(t.asText().length).toBeLessThanOrEqual(60);
  });
});
