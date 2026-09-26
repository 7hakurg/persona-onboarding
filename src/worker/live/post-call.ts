import type { CallEndReason, SessionState } from "../../shared/types";
import { extractionInstructions, followupInstructions } from "../conductor/prompts";
import { executeTool } from "../conductor/tools";
import type { JsonSchemaObject, LlmClient } from "../llm/types";
import { errorFields, log } from "../log";
import { slotValue } from "../../shared/selectors";

const EXTRACTION_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    userName: { type: "string", description: "The user's own name as they want to be called, or empty" },
    helpGoal: { type: "string", description: "What the user said they want help with, or empty" },
  },
  required: ["userName", "helpGoal"],
  additionalProperties: false,
};

export interface Extracted {
  userName: string;
  helpGoal: string;
}

export async function extractFromTranscript(llm: LlmClient, transcript: string): Promise<Extracted> {
  const res = await llm.respond({
    instructions: extractionInstructions(),
    input: [{ type: "message", role: "user", content: transcript }],
    json: { name: "call_facts", schema: EXTRACTION_SCHEMA },
  });
  const parsed = JSON.parse(res.outputText) as Partial<Extracted>;
  return {
    userName: typeof parsed.userName === "string" ? parsed.userName : "",
    helpGoal: typeof parsed.helpGoal === "string" ? parsed.helpGoal : "",
  };
}

/** Applies extracted facts through the same validated tools the live call uses. */
export function applyExtracted(state: SessionState, facts: Extracted, now: number): SessionState {
  let next = state;
  if (facts.userName.trim() && slotValue(next.slots.userName) === null && next.slots.userName.status !== "pending_confirmation") {
    next = executeTool(next, { name: "set_user_name", argsJson: JSON.stringify({ name: facts.userName, confirmed: false }), channel: "voice", now }).state;
  }
  if (facts.helpGoal.trim() && slotValue(next.slots.helpGoal) === null) {
    next = executeTool(next, { name: "set_help_goal", argsJson: JSON.stringify({ goal: facts.helpGoal }), channel: "voice", now }).state;
  }
  return next;
}

const FALLBACK_FOLLOWUP: Record<CallEndReason, string> = {
  completed: "Great chatting! You're all set — I'm here whenever you need me.",
  user_hangup: "Looks like the call ended — no worries. Want me to call back, or should we just finish here over text?",
  declined: "No problem, we can do this over text instead. 🙂",
  no_answer: "Missed you! Totally fine — we can keep going over text, or I can try calling again.",
  mic_denied: "Looks like your mic is blocked, so the call couldn't start. No worries — let's just text.",
  connection_failed: "Hmm, the call couldn't connect on my end. Let's keep going over text for now.",
  dropped: "Looks like we got cut off! Want me to call back, or just finish up here?",
  max_duration: "We hit the time limit on that call — let's wrap up the last bits over text.",
  page_closed: "Looks like the call ended when you left the page. Want to pick up where we left off here?",
  moderated: "That call had to end. Let's keep going over text.",
  budget_exhausted: "Calls are taking a break right now — let's do this over text instead.",
};

export async function composeFollowup(llm: LlmClient, state: SessionState, reason: CallEndReason): Promise<string> {
  try {
    const res = await llm.respond({ instructions: followupInstructions(state, reason), input: [{ type: "message", role: "developer", content: "Write the text message now." }] });
    const text = res.outputText.trim();
    return text || FALLBACK_FOLLOWUP[reason];
  } catch (err) {
    log("warn", "followup_failed", errorFields(err));
    return FALLBACK_FOLLOWUP[reason];
  }
}
