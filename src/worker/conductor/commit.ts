import type { ChatMessage, SessionState } from "../../shared/types";
import { appendMessage } from "../state/reducers";
import { executeTool, type Effect } from "./tools";

export interface RecordedInvocation {
  name: string;
  argsJson: string;
}

/** What a chat turn decided, independent of the snapshot it was computed from. */
export interface TurnRecord {
  invocations: RecordedInvocation[];
  replies: ChatMessage[];
}

/**
 * Applies a finished turn to the *latest* state by replaying its tool calls through the
 * same validated tools. Writes that happened while the model was thinking (voice tools,
 * post-call extraction, a Gmail callback, new user messages) are preserved, and effects
 * are recomputed so a stale decision (e.g. ringing twice) cannot fire.
 */
export function commitTurn(latest: SessionState, record: TurnRecord, now: number): { state: SessionState; effects: Effect[] } {
  let state = latest;
  const effects: Effect[] = [];
  for (const inv of record.invocations) {
    const out = executeTool(state, { name: inv.name, argsJson: inv.argsJson, channel: "text", now });
    state = out.state;
    effects.push(...out.effects);
  }
  for (const reply of record.replies) state = appendMessage(state, reply);
  return { state, effects };
}
