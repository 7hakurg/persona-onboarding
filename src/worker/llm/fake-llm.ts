import type { FunctionCall, InputItem, LlmClient, LlmRequest, LlmResponse } from "./types";

/**
 * Deterministic stand-in for the model, used by tests and E2E runs (FAKE_LLM=1).
 * It understands the same phrasings the real conductor is expected to handle.
 */
const NAME = /\b(?:my name is|i'm|im|i am|call me)\s+([a-z][a-z'\-]{0,30})\b/i;
const AGENT = /\b(?:call yourself|your name is|i'll call you|name you)\s+([\p{L}\p{N} .'\-]{1,30}?)(?=[.,!?]|$)/iu;
const GOAL = /\b(?:help(?: me)?(?: with)?|need help(?: with)?)\s+(?:my\s+)?([^.!?\n]{2,120})/i;

const REPLIES: Record<string, string> = {
  name_agent: "First things first — what do you want to call me?",
  offer_call: "Love it. Mind if I give you a quick call to get set up? Takes two minutes.",
  user_name: "What should I call you?",
  confirm_user_name: "Just checking — is that really what you want me to call you?",
  help_goal: "What's one thing you'd love help with right now?",
  gmail: "Want to connect Gmail so I can actually help? I only read, never send.",
  wrap_up: "You're all set! Want me to take you into the app?",
  done: "Anything else I can do?",
};

function goalFrom(instructions: string): string {
  return /Current goal: (\w+)/.exec(instructions)?.[1] ?? "done";
}

function lastUserText(input: InputItem[]): string | null {
  const last = input.at(-1);
  return last?.type === "message" && last.role === "user" ? last.content : null;
}

let counter = 0;
const call = (name: string, args: Record<string, unknown>): FunctionCall => ({
  callId: `fake_${++counter}`,
  name,
  argsJson: JSON.stringify(args),
});

function quickReplyCall(text: string): FunctionCall | null {
  const t = text.trim().toLowerCase();
  if (/^(call me( back)?|actually, call me|yes,? call me)$/.test(t)) return call("start_call", {});
  if (/(skip to the app|take me to the app|skip onboarding)/.test(t)) return call("graduate", {});
  if (/^connect gmail$/.test(t)) return call("send_gmail_link", {});
  return null;
}

function extractCalls(text: string, goal: string): FunctionCall[] {
  const quick = quickReplyCall(text);
  if (quick) return [quick];
  const calls: FunctionCall[] = [];
  const agent = AGENT.exec(text)?.[1];
  const name = NAME.exec(text)?.[1];
  const helpGoal = GOAL.exec(text)?.[1];
  if (agent) calls.push(call("set_agent_name", { name: agent.trim() }));
  else if (goal === "name_agent" && text.trim().split(/\s+/).length <= 3) calls.push(call("set_agent_name", { name: text.trim() }));
  if (name) calls.push(call("set_user_name", { name, confirmed: false }));
  else if (goal === "user_name" && text.trim().split(/\s+/).length <= 3) calls.push(call("set_user_name", { name: text.trim(), confirmed: false }));
  if (helpGoal) calls.push(call("set_help_goal", { goal: helpGoal.trim() }));
  return calls;
}

function structured(input: InputItem[]): LlmResponse {
  const text = input.map((i) => (i.type === "message" ? i.content : "")).join("\n");
  const out: Record<string, string> = {};
  const name = NAME.exec(text)?.[1];
  const helpGoal = GOAL.exec(text)?.[1];
  if (name) out.userName = name;
  if (helpGoal) out.helpGoal = helpGoal.trim();
  return { outputText: JSON.stringify(out), calls: [] };
}

export function createFakeLlm(): LlmClient {
  return {
    async respond(req: LlmRequest): Promise<LlmResponse> {
      if (req.json) return structured(req.input);
      const goal = goalFrom(req.instructions);
      const last = req.input.at(-1);
      if (last?.type === "function_call_output" && last.output.includes("nudge_first")) {
        return { outputText: "Before you go — connecting Gmail is where I'm most useful. Want to do that first, or skip it for now?", calls: [] };
      }
      const text = lastUserText(req.input);
      if (text !== null && req.tools?.length) {
        const calls = extractCalls(text, goal);
        if (calls.length > 0) return { outputText: "", calls };
      }
      return { outputText: REPLIES[goal] ?? REPLIES.done!, calls: [] };
    },
  };
}
