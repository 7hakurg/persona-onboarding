import type { Channel, Goal, MissingKey, SessionState } from "../../shared/types";
import { CONFIG } from "../config";
import {
  appendEvent,
  graduate,
  markNudge,
  recordInvalidAttempt,
  setGmail,
  setSlot,
} from "../state/reducers";
import { isCallLive, isGmailDone, missingSlots, nextGoal } from "../state/selectors";
import { validateAgentName, validateHelpGoal, validateUserName } from "./slots";
import { TOOL_SPECS, isToolName, type ToolName } from "./tool-schemas";

export { toolDefinitions } from "./tool-schemas";
export type { ToolName } from "./tool-schemas";

export interface ToolResult {
  ok: boolean;
  error?: string;
  saved?: Record<string, string>;
  needsConfirmation?: boolean;
  stillMissing: MissingKey[];
  nextStep: string;
}

export type Effect =
  | { type: "ring" }
  | { type: "post_gmail_card" }
  | { type: "end_call"; reason: "completed" }
  | { type: "graduated" };

export interface ToolOutcome {
  state: SessionState;
  result: ToolResult;
  effects: Effect[];
}

export interface ToolInvocation {
  name: string;
  argsJson: string;
  channel: Channel;
  now: number;
}

interface Partial {
  state: SessionState;
  ok: boolean;
  error?: string;
  saved?: Record<string, string>;
  needsConfirmation?: boolean;
  effects?: Effect[];
}

const NEXT_STEP: Record<Goal, string> = {
  name_agent: "Ask what the user wants to call you.",
  offer_call: "Offer a quick call to get set up (or keep texting if they prefer).",
  on_call: "Continue the call.",
  confirm_user_name: "Playfully confirm the unusual name before saving it for real.",
  user_name: "Learn what to call the user.",
  help_goal: "Learn what the user wants help with.",
  gmail: "Invite the user to connect Gmail so you can actually help.",
  wrap_up: "Everything is set. Wrap up warmly and offer to take them into the app.",
  done: "Onboarding is complete.",
};

function finish(invocation: ToolInvocation, before: SessionState, p: Partial): ToolOutcome {
  const detail = p.ok ? JSON.stringify(p.saved ?? {}) : (p.error ?? "error");
  const state = appendEvent(p.state, { at: invocation.now, type: `tool:${invocation.name}`, detail: `${invocation.channel} ${detail}` });
  return {
    state: p.ok || p.state !== before ? state : before,
    effects: p.effects ?? [],
    result: {
      ok: p.ok,
      ...(p.error ? { error: p.error } : {}),
      ...(p.saved ? { saved: p.saved } : {}),
      ...(p.needsConfirmation ? { needsConfirmation: true } : {}),
      stillMissing: missingSlots(state),
      nextStep: NEXT_STEP[nextGoal(state)],
    },
  };
}

function reject(state: SessionState, error: string): ToolOutcome {
  return { state, effects: [], result: { ok: false, error, stillMissing: missingSlots(state), nextStep: NEXT_STEP[nextGoal(state)] } };
}

function setUserName(state: SessionState, args: { name: string; confirmed: boolean }, inv: ToolInvocation): Partial {
  const v = validateUserName(args.name);
  if (!v.ok) return { state: recordInvalidAttempt(state, "userName"), ok: false, error: `invalid_name:${v.reason}` };
  const pending = state.slots.userName;
  const confirmsPending =
    args.confirmed && pending.status === "pending_confirmation" && pending.value.toLowerCase() === v.value.toLowerCase();
  if (v.needsConfirmation && !confirmsPending) {
    const next = setSlot(state, "userName", { status: "pending_confirmation", value: v.value, source: inv.channel });
    return { state: next, ok: true, needsConfirmation: true, saved: { userNamePending: v.value } };
  }
  const value = confirmsPending && pending.status === "pending_confirmation" ? pending.value : v.value;
  const next = setSlot(state, "userName", { status: "filled", value, source: inv.channel, at: inv.now });
  return { state: next, ok: true, saved: { userName: value } };
}

function setAgentName(state: SessionState, args: { name: string }, inv: ToolInvocation): Partial {
  const v = validateAgentName(args.name);
  if (!v.ok) return { state: recordInvalidAttempt(state, "agentName"), ok: false, error: `invalid_name:${v.reason}` };
  const next = setSlot(state, "agentName", { status: "filled", value: v.value, source: inv.channel, at: inv.now });
  return { state: next, ok: true, saved: { agentName: v.value } };
}

function setHelpGoal(state: SessionState, args: { goal: string }, inv: ToolInvocation): Partial {
  const v = validateHelpGoal(args.goal);
  if (!v.ok) return { state: recordInvalidAttempt(state, "helpGoal"), ok: false, error: `invalid_goal:${v.reason}` };
  const next = setSlot(state, "helpGoal", { status: "filled", value: v.value, source: inv.channel, at: inv.now });
  return { state: next, ok: true, saved: { helpGoal: v.value } };
}

function sendGmailLink(state: SessionState, inv: ToolInvocation): Partial {
  if (isGmailDone(state)) return { state, ok: true, saved: { gmail: "already connected" } };
  if (state.gmail.status === "link_sent") return { state, ok: true, saved: { gmail: "button already in chat" } };
  return { state: setGmail(state, { status: "link_sent", at: inv.now }), ok: true, saved: { gmail: "button sent to chat" }, effects: [{ type: "post_gmail_card" }] };
}

function startCall(state: SessionState): Partial {
  if (isCallLive(state)) return { state, ok: false, error: "call_in_progress" };
  if (state.callAttempts >= CONFIG.limits.callsPerSession) return { state, ok: false, error: "call_limit" };
  return { state, ok: true, saved: { call: "ringing" }, effects: [{ type: "ring" }] };
}

function graduateTool(state: SessionState, inv: ToolInvocation): Partial {
  if (!isGmailDone(state) && !state.nudges.gmailBeforeGraduate) {
    return { state: markNudge(state, "gmailBeforeGraduate"), ok: false, error: "nudge_first" };
  }
  return { state: graduate(state, inv.now), ok: true, saved: { onboarding: "complete" }, effects: [{ type: "graduated" }] };
}

function dispatch(name: ToolName, args: never, state: SessionState, inv: ToolInvocation): Partial {
  switch (name) {
    case "set_user_name":
      return setUserName(state, args, inv);
    case "set_agent_name":
      return setAgentName(state, args, inv);
    case "set_help_goal":
      return setHelpGoal(state, args, inv);
    case "send_gmail_link":
      return sendGmailLink(state, inv);
    case "check_gmail_status":
      return { state, ok: true, saved: { gmail: state.gmail.status } };
    case "start_call":
      return startCall(state);
    case "end_call":
      return { state, ok: true, saved: { call: "ending" }, effects: [{ type: "end_call", reason: "completed" }] };
    case "graduate":
      return graduateTool(state, inv);
  }
}

function parseArgs(argsJson: string): unknown {
  try {
    return JSON.parse(argsJson === "" ? "{}" : argsJson);
  } catch {
    return undefined;
  }
}

export function executeTool(state: SessionState, inv: ToolInvocation): ToolOutcome {
  if (!isToolName(inv.name)) return reject(state, "unknown_tool");
  const spec = TOOL_SPECS[inv.name];
  if (!spec.channels.includes(inv.channel)) return reject(state, "not_allowed_on_channel");
  const parsed = spec.args.safeParse(parseArgs(inv.argsJson));
  if (!parsed.success) return reject(state, "invalid_arguments");
  return finish(inv, state, dispatch(inv.name, parsed.data as never, state, inv));
}
