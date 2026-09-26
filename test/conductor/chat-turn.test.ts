import { describe, expect, it } from "vitest";
import { runChatTurn } from "../../src/worker/conductor/chat-turn";
import { createFakeLlm } from "../../src/worker/llm/fake-llm";
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from "../../src/worker/llm/types";
import { createInitialState } from "../../src/worker/state/initial";
import { appendMessage } from "../../src/worker/state/reducers";
import { FALLBACK_REPLY } from "../../src/worker/conductor/prompts";
import { CONFIG } from "../../src/worker/config";
import { NOW } from "../state/fixtures";

let id = 0;
const deps = (llm: LlmClient) => ({ llm, now: () => NOW, newId: () => `id${++id}` });
const withUser = (text: string) =>
  appendMessage(createInitialState(NOW), { id: "u1", at: NOW, role: "user", kind: "text", text });

function scripted(responses: Array<LlmResponse | Error>): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async respond(req) {
      requests.push(req);
      const next = responses.shift() ?? { outputText: "ok", calls: [] };
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe("runChatTurn", () => {
  it("fills several slots from one message and replies", async () => {
    const out = await runChatTurn(withUser("lol ok im sam, call yourself jarvis. i need help with my email"), deps(createFakeLlm()));
    expect(out.state.slots.userName).toMatchObject({ status: "filled", value: "Sam" });
    expect(out.state.slots.agentName).toMatchObject({ status: "filled", value: "Jarvis" });
    expect(out.state.slots.helpGoal).toMatchObject({ status: "filled" });
    const last = out.state.messages.at(-1);
    expect(last).toMatchObject({ role: "assistant", kind: "text" });
    expect(last?.text.length).toBeGreaterThan(0);
  });

  it("sends tool outputs back to the model and rebuilds instructions with new state", async () => {
    const llm = scripted([
      { outputText: "", calls: [{ callId: "c1", name: "set_agent_name", argsJson: "{\"name\":\"Friday\"}" }] },
      { outputText: "Friday it is!", calls: [] },
    ]);
    const out = await runChatTurn(withUser("Friday"), deps(llm));
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]?.input.slice(-2)).toEqual([
      { type: "function_call", call_id: "c1", name: "set_agent_name", arguments: "{\"name\":\"Friday\"}" },
      { type: "function_call_output", call_id: "c1", output: expect.stringContaining("\"ok\":true") },
    ]);
    expect(llm.requests[1]?.instructions).toContain("Assistant name: Friday");
    expect(out.state.messages.at(-1)?.text).toBe("Friday it is!");
  });

  it("caps the tool loop and forces a text reply", async () => {
    const loop = { outputText: "", calls: [{ callId: "c", name: "check_gmail_status", argsJson: "{}" }] };
    const llm = scripted(Array.from({ length: 10 }, () => ({ ...loop })));
    await runChatTurn(withUser("hi"), deps(llm));
    expect(llm.requests).toHaveLength(CONFIG.limits.toolLoopMaxIterations + 1);
    expect(llm.requests.at(-1)?.tools).toBeUndefined();
  });

  it("returns effects from tools", async () => {
    const llm = scripted([{ outputText: "Ringing you now!", calls: [{ callId: "c", name: "start_call", argsJson: "{}" }] }]);
    const out = await runChatTurn(withUser("call me"), deps(llm));
    expect(out.effects).toEqual([{ type: "ring" }]);
  });

  it("falls back gracefully when the model fails", async () => {
    const before = withUser("hi");
    const out = await runChatTurn(before, deps(scripted([new LlmError("timeout", "slow")])));
    expect(out.state.messages.at(-1)).toMatchObject({ role: "assistant", text: FALLBACK_REPLY });
    expect(out.state.slots).toEqual(before.slots);
  });

  it("uses a default line when the model returns no text", async () => {
    const out = await runChatTurn(withUser("hmm"), deps(scripted([{ outputText: "  ", calls: [] }])));
    expect(out.state.messages.at(-1)?.text).toMatch(/call me/i);
  });

  it("only sends recent text messages as context", async () => {
    let s = createInitialState(NOW);
    for (let i = 0; i < 50; i++) s = appendMessage(s, { id: `m${i}`, at: NOW, role: i % 2 ? "assistant" : "user", kind: "text", text: `msg ${i}` });
    const llm = scripted([{ outputText: "ok", calls: [] }]);
    await runChatTurn(s, deps(llm));
    expect(llm.requests[0]?.input).toHaveLength(CONFIG.history.chatContextMessages);
  });
});
