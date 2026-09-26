import type { ChatMessage, SessionState } from "../../shared/types";
import { CONFIG } from "../config";
import type { InputItem, LlmClient } from "../llm/types";
import { errorFields, log } from "../log";
import { appendMessage } from "../state/reducers";
import { FALLBACK_REPLY, chatInstructions, defaultLine } from "./prompts";
import { executeTool, toolDefinitions, type Effect } from "./tools";

export interface TurnDeps {
  llm: LlmClient;
  now: () => number;
  newId: () => string;
}

export interface TurnOutcome {
  state: SessionState;
  effects: Effect[];
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

function reply(state: SessionState, text: string, deps: TurnDeps): SessionState {
  const clean = text.trim() || defaultLine(state);
  return appendMessage(state, { id: deps.newId(), at: deps.now(), role: "assistant", kind: "text", text: clean });
}

export async function runChatTurn(initial: SessionState, deps: TurnDeps): Promise<TurnOutcome> {
  let state = initial;
  const effects: Effect[] = [];
  const input = contextItems(state);
  const max = CONFIG.limits.toolLoopMaxIterations;
  try {
    for (let iteration = 0; iteration <= max; iteration++) {
      const allowTools = iteration < max;
      const res = await deps.llm.respond({
        instructions: chatInstructions(state),
        input,
        ...(allowTools ? { tools: toolDefinitions("text") } : {}),
      });
      if (!allowTools || res.calls.length === 0) return { state: reply(state, res.outputText, deps), effects };
      for (const call of res.calls) {
        const out = executeTool(state, { name: call.name, argsJson: call.argsJson, channel: "text", now: deps.now() });
        state = out.state;
        effects.push(...out.effects);
        input.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.argsJson });
        input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(out.result) });
      }
    }
  } catch (err) {
    log("error", "chat_turn_failed", errorFields(err));
    return { state: reply(state, FALLBACK_REPLY, deps), effects };
  }
  return { state: reply(state, "", deps), effects };
}
