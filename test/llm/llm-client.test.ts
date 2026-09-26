import { describe, expect, it } from "vitest";
import { createOpenAiClient } from "../../src/worker/llm/llm-client";
import { LlmError } from "../../src/worker/llm/types";

type Call = { url: string; body: Record<string, unknown>; headers: Headers };

function stubFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error("no more stub responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl: impl as typeof fetch, calls };
}

const ok = (output: unknown[]) => new Response(JSON.stringify({ id: "resp_1", output }), { status: 200 });

describe("createOpenAiClient", () => {
  it("sends a Responses request and parses text plus function calls", async () => {
    const { impl, calls } = stubFetch([
      ok([
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "set_user_name", arguments: "{\"name\":\"Sam\",\"confirmed\":false}" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Nice to meet you, " }, { type: "output_text", text: "Sam!" }] },
      ]),
    ]);
    const client = createOpenAiClient({ apiKey: "k", model: "gpt-6-luna", reasoningEffort: "low", fetchImpl: impl });
    const res = await client.respond({ instructions: "be nice", input: [{ type: "message", role: "user", content: "I'm Sam" }] });
    expect(res.outputText).toBe("Nice to meet you, Sam!");
    expect(res.calls).toEqual([{ callId: "call_1", name: "set_user_name", argsJson: "{\"name\":\"Sam\",\"confirmed\":false}" }]);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer k");
    expect(calls[0]?.body).toMatchObject({ model: "gpt-6-luna", instructions: "be nice", store: false, reasoning: { effort: "low" } });
  });

  it("requests structured output when json is set", async () => {
    const { impl, calls } = stubFetch([ok([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }])]);
    const client = createOpenAiClient({ apiKey: "k", model: "m", reasoningEffort: "low", fetchImpl: impl });
    const schema = { type: "object" as const, properties: {}, required: [], additionalProperties: false as const };
    await client.respond({ instructions: "x", input: [], json: { name: "extract", schema } });
    expect(calls[0]?.body.text).toEqual({ format: { type: "json_schema", name: "extract", schema, strict: true } });
  });

  it("retries once on a 503 and then succeeds", async () => {
    const { impl, calls } = stubFetch([new Response("busy", { status: 503 }), ok([])]);
    const client = createOpenAiClient({ apiKey: "k", model: "m", reasoningEffort: "low", fetchImpl: impl });
    await expect(client.respond({ instructions: "x", input: [] })).resolves.toEqual({ outputText: "", calls: [] });
    expect(calls).toHaveLength(2);
  });

  it("throws LlmError after a second failure", async () => {
    const { impl } = stubFetch([new Response("busy", { status: 503 }), new Response("busy", { status: 500 })]);
    const client = createOpenAiClient({ apiKey: "k", model: "m", reasoningEffort: "low", fetchImpl: impl });
    await expect(client.respond({ instructions: "x", input: [] })).rejects.toBeInstanceOf(LlmError);
  });

  it("does not retry a 400", async () => {
    const { impl, calls } = stubFetch([new Response("bad", { status: 400 })]);
    const client = createOpenAiClient({ apiKey: "k", model: "m", reasoningEffort: "low", fetchImpl: impl });
    await expect(client.respond({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "http_error" });
    expect(calls).toHaveLength(1);
  });

  it("maps aborts to a timeout error", async () => {
    const abort = new DOMException("timed out", "TimeoutError");
    const { impl } = stubFetch([abort, abort]);
    const client = createOpenAiClient({ apiKey: "k", model: "m", reasoningEffort: "low", fetchImpl: impl });
    await expect(client.respond({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "timeout" });
  });
});
