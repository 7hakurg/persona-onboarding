import type { Goal, MissingKey, Phase, SessionState, Slot } from "../../shared/types";

const ORDER: MissingKey[] = ["agentName", "userName", "helpGoal", "gmail"];

export function slotValue(slot: Slot<string>): string | null {
  return slot.status === "filled" || slot.status === "defaulted" ? slot.value : null;
}

export function isGmailDone(state: SessionState): boolean {
  return state.gmail.status === "connected" || state.gmail.status === "connected_limited";
}

export function missingSlots(state: SessionState): MissingKey[] {
  return ORDER.filter((key) =>
    key === "gmail" ? !isGmailDone(state) : slotValue(state.slots[key]) === null,
  );
}

export function isCallLive(state: SessionState): boolean {
  const s = state.call.status;
  return s === "ringing" || s === "connecting" || s === "active";
}

export function nextGoal(state: SessionState): Goal {
  if (state.graduatedAt !== null) return "done";
  const { agentName, userName, helpGoal } = state.slots;
  if (agentName.status === "empty" || agentName.status === "pending_confirmation") return "name_agent";
  if (isCallLive(state)) return "on_call";
  const missing = missingSlots(state);
  if (state.callAttempts === 0 && missing.length > 0) return "offer_call";
  if (userName.status === "pending_confirmation") return "confirm_user_name";
  if (userName.status === "empty") return "user_name";
  if (helpGoal.status === "empty" || helpGoal.status === "pending_confirmation") return "help_goal";
  if (!isGmailDone(state)) return "gmail";
  return "wrap_up";
}

export function phaseOf(state: SessionState): Phase {
  const goal = nextGoal(state);
  if (goal === "done") return "graduated";
  if (goal === "name_agent") return "naming";
  if (goal === "on_call" || goal === "offer_call") return "calling";
  if (goal === "wrap_up") return "wrapup";
  return "collecting_text";
}

const FAILED_CALL = new Set(["dropped", "connection_failed", "user_hangup", "max_duration", "no_answer", "declined", "mic_denied", "page_closed"]);

export function quickReplies(state: SessionState): string[] {
  if (state.turnPending) return [];
  const goal = nextGoal(state);
  switch (goal) {
    case "done":
    case "on_call":
      return [];
    case "name_agent":
      return ["Jarvis", "Friday", "You pick"];
    case "offer_call":
      return ["Call me", "Let's just text", "Skip to the app"];
    case "gmail":
      return ["Connect Gmail", "Skip for now"];
    case "wrap_up":
      return ["Take me to the app"];
    default:
      if (state.call.status === "ended" && FAILED_CALL.has(state.call.reason)) {
        return ["Call me back", "Text is fine", "Skip to the app"];
      }
      return ["Skip to the app"];
  }
}

function gmailLine(state: SessionState): string {
  switch (state.gmail.status) {
    case "connected":
      return `connected (${state.gmail.email}, ${state.gmail.snapshot.unreadCount} unread this week)`;
    case "connected_limited":
      return `connected without inbox access (${state.gmail.email})`;
    case "link_sent":
      return "connect link sent, waiting for the user";
    case "declined":
      return "user declined to connect";
    case "error":
      return "connection failed";
    default:
      return "not connected";
  }
}

export function summaryForPrompt(state: SessionState): string {
  const show = (slot: Slot<string>) =>
    slot.status === "pending_confirmation"
      ? `"${slot.value}" (needs confirmation)`
      : slot.status === "parked"
        ? "unknown (user avoided it; don't push)"
        : (slotValue(slot) ?? "unknown");
  return [
    `Assistant name: ${show(state.slots.agentName)}`,
    `User name: ${show(state.slots.userName)}`,
    `Help goal: ${show(state.slots.helpGoal)}`,
    `Gmail: ${gmailLine(state)}`,
  ].join("\n");
}
