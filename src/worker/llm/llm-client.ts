import { CONFIG } from "../config";
import { LlmError, type FunctionCall, type LlmClient, type LlmRequest, type LlmResponse } from "./types";

export interface OpenAiClientOptions {
  apiKey: string;
  model: string;
  reasoningEffort: "none" | "low" | "medium" | "high";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface OutputItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string }[];
}

function buildBody(model: string, effort: string, req: LlmRequest): Record<string, unknown> {
  return {
    model,
    instructions: req.instructions,
    input: req.input,
    store: false,
    reasoning: { effort },
    ...(req.tools?.length ? { tools: req.tools, parallel_tool_calls: true } : {}),
    ...(req.json ? { text: { format: { type: "json_schema", name: req.json.name, schema: req.json.schema, strict: true } } } : {}),
  };
}

function parseOutput(payload: unknown): LlmResponse {
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new LlmError("bad_response", "Response has no output array");
  const calls: FunctionCall[] = [];
  let outputText = "";
  for (const item of output as OutputItem[]) {
    if (item.type === "function_call" && item.call_id && item.name) {
      calls.push({ callId: item.call_id, name: item.name, argsJson: item.arguments ?? "{}" });
    } else if (item.type === "message") {
      outputText += (item.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
    }
  }
  return { outputText, calls };
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
}

export function createOpenAiClient(opts: OpenAiClientOptions): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? CONFIG.openai.requestTimeoutMs;

  async function attempt(body: string): Promise<Response> {
    try {
      return await fetchImpl(`${CONFIG.openai.baseUrl}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw new LlmError("timeout", `OpenAI request timed out after ${timeoutMs}ms`);
      throw new LlmError("http_error", err instanceof Error ? err.message : "network error");
    }
  }

  return {
    async respond(req: LlmRequest): Promise<LlmResponse> {
      const body = JSON.stringify(buildBody(opts.model, opts.reasoningEffort, req));
      let lastError: LlmError | null = null;
      for (let i = 0; i < 2; i++) {
        try {
          const res = await attempt(body);
          if (res.ok) return parseOutput(await res.json());
          lastError = new LlmError("http_error", `OpenAI responded ${res.status}`);
          if (!isRetryable(res.status)) throw lastError;
        } catch (err) {
          if (!(err instanceof LlmError) || err === lastError) throw err;
          lastError = err;
        }
      }
      throw lastError ?? new LlmError("http_error", "OpenAI request failed");
    },
  };
}
