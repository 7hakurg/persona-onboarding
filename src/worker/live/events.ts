import { z } from "zod";

export type LiveEvent =
  | { kind: "started" }
  | { kind: "transcript"; speaker: "user" | "assistant"; delta: string }
  | { kind: "function_call"; callId: string; name: string; argsJson: string }
  | { kind: "usage"; seconds: number }
  | { kind: "closed"; reason: string }
  | { kind: "error"; code: string; message: string }
  | { kind: "ignored" };

const Transcript = z.object({ delta: z.string() });
const Usage = z.object({ usage: z.object({ seconds: z.number() }) });
const Closed = z.object({ reason: z.string() });
const ErrorEvent = z.object({ error: z.object({ code: z.string().nullish(), message: z.string().nullish() }) });
const ResponseEnvelope = z.object({
  event: z.object({
    type: z.string(),
    item: z.object({ type: z.string(), call_id: z.string().optional(), name: z.string().optional(), arguments: z.string().optional() }).optional(),
  }),
});

const IGNORED: LiveEvent = { kind: "ignored" };

function functionCall(raw: unknown): LiveEvent {
  const env = ResponseEnvelope.safeParse(raw);
  if (!env.success) return IGNORED;
  const { type, item } = env.data.event;
  if (type !== "response.output_item.done" || item?.type !== "function_call" || !item.call_id || !item.name) return IGNORED;
  return { kind: "function_call", callId: item.call_id, name: item.name, argsJson: item.arguments ?? "{}" };
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, map: (v: T) => LiveEvent): LiveEvent {
  const r = schema.safeParse(raw);
  return r.success ? map(r.data) : IGNORED;
}

/** Normalizes one GPT-Live server event. Unknown or malformed events are ignored, never thrown. */
export function parseLiveEvent(data: string): LiveEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return IGNORED;
  }
  const type = (raw as { type?: unknown })?.type;
  switch (type) {
    case "session.started":
      return { kind: "started" };
    case "session.input_transcript.delta":
      return parse(Transcript, raw, (v) => ({ kind: "transcript", speaker: "user", delta: v.delta }));
    case "session.output_transcript.delta":
      return parse(Transcript, raw, (v) => ({ kind: "transcript", speaker: "assistant", delta: v.delta }));
    case "response.event":
      return functionCall(raw);
    case "session.usage.updated":
      return parse(Usage, raw, (v) => ({ kind: "usage", seconds: v.usage.seconds }));
    case "session.closed":
      return parse(Closed, raw, (v) => ({ kind: "closed", reason: v.reason }));
    case "error":
      return parse(ErrorEvent, raw, (v) => ({ kind: "error", code: v.error.code ?? "unknown", message: v.error.message ?? "" }));
    default:
      return IGNORED;
  }
}
