import type { ChatMessage, SessionState } from "../../shared/types";
import { appendEvent, appendMessage, setGmail } from "../state/reducers";
import type { GmailCompletion } from "./completion";
import { describeSnapshot } from "./insight";

interface Ids {
  now: number;
  newId: () => string;
}

function assistant(ids: Ids, text: string, data?: ChatMessage["data"]): ChatMessage {
  return { id: ids.newId(), at: ids.now, role: "assistant", kind: data ? "card" : "text", text, ...(data ? { data } : {}) };
}

/** Pure: applies an OAuth outcome to the session and returns a note for a live call, if any. */
export function applyGmailCompletion(state: SessionState, c: GmailCompletion, insight: string | null, ids: Ids): { state: SessionState; callNote: string } {
  const logged = appendEvent(state, { at: ids.now, type: `gmail:${c.outcome}`, detail: "" });
  switch (c.outcome) {
    case "declined":
      return {
        state: appendMessage(setGmail(logged, { status: "declined", at: ids.now }), assistant(ids, "No worries — nothing was connected. You can hook up Gmail anytime later.")),
        callNote: "The user cancelled the Gmail connection. Don't push; they can do it later.",
      };
    case "error":
      return {
        state: appendMessage(setGmail(logged, { status: "error", reason: c.reason }), assistant(ids, "Hmm, the Gmail connection hiccuped on Google's side. Want to try the button again?")),
        callNote: "The Gmail connection failed on Google's side. Offer to try again later.",
      };
    case "limited":
      return {
        state: appendMessage(
          setGmail(logged, { status: "connected_limited", email: c.email }),
          assistant(ids, `Connected as ${c.email} — but without inbox access, so I can't help with email yet. You can grant it anytime.`, { card: "gmail", status: "limited", email: c.email }),
        ),
        callNote: `Gmail connected as ${c.email}, but the user didn't grant inbox access.`,
      };
    case "connected": {
      const text = insight ?? "";
      const next = setGmail(logged, { status: "connected", email: c.email, snapshot: c.snapshot, insight: text, canManage: c.grant.canManage });
      return {
        state: appendMessage(next, assistant(ids, text, { card: "insight", email: c.email, unreadCount: c.snapshot.unreadCount, topSenders: c.snapshot.topSenders, insight: text })),
        callNote: `Gmail just connected (${c.email}). ${describeSnapshot(c.snapshot)} Mention one useful observation briefly.`,
      };
    }
  }
}
