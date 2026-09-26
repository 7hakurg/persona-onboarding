import type { SessionState } from "../../shared/types";
import { CONFIG } from "../config";

function appended<T>(before: readonly T[], after: readonly T[]): T[] {
  const seen = new Set(before);
  return after.filter((item) => !seen.has(item));
}

/**
 * A chat turn computes `after` from a `before` snapshot while other writes may
 * have produced `latest`. Fields the turn changed win; everything else keeps
 * its latest value; list additions from both sides are kept in order.
 */
export function mergeTurnResult(latest: SessionState, before: SessionState, after: SessionState): SessionState {
  const merged: Record<string, unknown> = { ...latest };
  for (const key of Object.keys(after) as (keyof SessionState)[]) {
    if (key === "messages" || key === "events") continue;
    if (after[key] !== before[key]) merged[key] = after[key];
  }
  const messages = [...latest.messages, ...appended(before.messages, after.messages)];
  const events = [...latest.events, ...appended(before.events, after.events)];
  return {
    ...(merged as unknown as SessionState),
    messages: messages.slice(-CONFIG.history.maxMessages),
    events: events.slice(-CONFIG.history.maxEvents),
  };
}
