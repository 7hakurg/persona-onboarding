import type { SessionState, Slot } from "../../shared/types";

export function slotText(slot: Slot<string>): string | null {
  if (slot.status === "filled" || slot.status === "defaulted") return slot.value;
  if (slot.status === "pending_confirmation") return `${slot.value}?`;
  return null;
}

export function agentDisplayName(state: SessionState | null): string {
  return (state && slotText(state.slots.agentName)?.replace(/\?$/, "")) || "New Assistant";
}

export function isCallLive(state: SessionState | null): boolean {
  const s = state?.call.status;
  return s === "ringing" || s === "connecting" || s === "active";
}

