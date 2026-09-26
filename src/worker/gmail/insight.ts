import type { InboxSnapshot } from "../../shared/types";
import { insightInstructions } from "../conductor/prompts";
import type { LlmClient } from "../llm/types";
import { errorFields, log } from "../log";

export function describeSnapshot(s: InboxSnapshot): string {
  const senders = s.topSenders.map((t) => `${t.name} (${t.count})`).join(", ") || "none";
  const subjects = s.sampleSubjects.map((x) => `"${x}"`).join("; ") || "none";
  return `Unread in the last 7 days: ${s.unreadCount}. Top unread senders: ${senders}. Sample subjects: ${subjects}.`;
}

export function fallbackInsight(s: InboxSnapshot): string {
  if (s.unreadCount === 0) return "Inbox zero this week — impressive. I'll keep an eye on things and flag what actually needs you.";
  const top = s.topSenders[0];
  const who = top ? ` — ${top.name} alone sent ${top.count}` : "";
  return `You've got ${s.unreadCount} unread from this week${who}. Want me to sort what needs you from what can wait?`;
}

export async function composeInsight(llm: LlmClient, snapshot: InboxSnapshot, helpGoal: string | null): Promise<string> {
  try {
    const res = await llm.respond({
      instructions: insightInstructions(helpGoal),
      input: [{ type: "message", role: "user", content: describeSnapshot(snapshot) }],
    });
    return res.outputText.trim() || fallbackInsight(snapshot);
  } catch (err) {
    log("warn", "insight_failed", errorFields(err));
    return fallbackInsight(snapshot);
  }
}
