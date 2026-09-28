import type { ChatMessage, SessionState } from "../../shared/types";
import { CONFIG } from "../config";
import { isGmailTool } from "../gmail/tool-schemas";
import type { FunctionTool, InputItem, LlmClient } from "../llm/types";
import { errorFields, log } from "../log";
import { appendMessage } from "../state/reducers";
import { FALLBACK_REPLY, chatInstructions, defaultLine } from "./prompts";
import type { RecordedInvocation, TurnRecord } from "./commit";
import { executeTool, toolDefinitions, type Effect } from "./tools";

export interface GmailToolExecutor {
  tools(): FunctionTool[];
  run(name: string, argsJson: string): Promise<{ result: Record<string, unknown>; cards: ChatMessage[] }>;
}

export interface TurnDeps {
  llm: LlmClient;
  now: () => number;
  newId: () => string;
  /** Present when the user connected Gmail with manage access. */
  gmail?: GmailToolExecutor;
}

export interface TurnOutcome {
  state: SessionState;
  effects: Effect[];
  /** Replayable record of the turn, for committing against newer state. */
  record: TurnRecord;
}

const CARD_CONTEXT: Record<string, (m: ChatMessage) => string> = {
  call: (m) => (m.data?.card === "call" ? `(Phone call ended: ${m.data.outcome}, ${Math.round(m.data.durationMs / 1000)}s)` : ""),
  gmail: (m) => (m.data?.card === "gmail" ? `(Gmail connect button shown; status: ${m.data.status})` : ""),
  insight: (m) => (m.data?.card === "insight" ? `(You shared this inbox insight: ${m.data.insight})` : ""),
};

function toInputItem(m: ChatMessage): InputItem | null {
  if (m.kind === "text" && (m.role === "user" || m.role === "assistant")) {
    return { type: "message", role: m.role, content: m.text };
  }
  const describe = m.data ? CARD_CONTEXT[m.data.card] : undefined;
  const text = describe ? describe(m) : m.text;
  return text ? { type: "message", role: "developer", content: text } : null;
}

export function contextItems(state: SessionState): InputItem[] {
  return state.messages
    .map(toInputItem)
    .filter((i): i is InputItem => i !== null)
    .slice(-CONFIG.history.chatContextMessages);
}

function replyMessage(state: SessionState, text: string, deps: TurnDeps): ChatMessage {
  return { id: deps.newId(), at: deps.now(), role: "assistant", kind: "text", text: text.trim() || defaultLine(state) };
}

export async function runChatTurn(initial: SessionState, deps: TurnDeps): Promise<TurnOutcome> {
  let state = initial;
  const effects: Effect[] = [];
  const invocations: RecordedInvocation[] = [];
  const cards: ChatMessage[] = [];
  const tools = [...toolDefinitions("text"), ...(deps.gmail?.tools() ?? [])];
  const input = contextItems(state);
  const max = CONFIG.limits.toolLoopMaxIterations;
  const done = (text: string): TurnOutcome => {
    const message = replyMessage(state, text, deps);
    const replies = [...cards, message];
    return { state: replies.reduce(appendMessage, state), effects, record: { invocations, replies } };
  };
  // Gmail tools have real side effects: run once now, keep their cards, never replay them.
  const runOne = async (name: string, argsJson: string): Promise<unknown> => {
    if (deps.gmail && isGmailTool(name)) {
      const out = await deps.gmail.run(name, argsJson);
      cards.push(...out.cards);
      return out.result;
    }
    const out = executeTool(state, { name, argsJson, channel: "text", now: deps.now() });
    state = out.state;
    effects.push(...out.effects);
    invocations.push({ name, argsJson });
    return out.result;
  };
  try {
    for (let iteration = 0; iteration <= max; iteration++) {
      const allowTools = iteration < max;
      const res = await deps.llm.respond({
        instructions: chatInstructions(state),
        input,
        ...(allowTools ? { tools } : {}),
      });
      if (!allowTools || res.calls.length === 0) return done(res.outputText);
      for (const call of res.calls) {
        const output = await runOne(call.name, call.argsJson);
        input.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.argsJson });
        input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) });
      }
    }
  } catch (err) {
    log("error", "chat_turn_failed", errorFields(err));
    return done(FALLBACK_REPLY);
  }
  return done("");
}
