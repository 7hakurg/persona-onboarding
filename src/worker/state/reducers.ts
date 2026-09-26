import type {
  CallState,
  ChatMessage,
  GmailState,
  SessionEvent,
  SessionState,
  Slot,
  SlotKey,
} from "../../shared/types";
import { CONFIG } from "../config";

export const DEFAULT_AGENT_NAME = "Persona";

function capTail<T>(items: readonly T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : [...items];
}

export function appendMessage(state: SessionState, message: ChatMessage): SessionState {
  return { ...state, messages: capTail([...state.messages, message], CONFIG.history.maxMessages) };
}

export function appendEvent(state: SessionState, event: SessionEvent): SessionState {
  return { ...state, events: capTail([...state.events, event], CONFIG.history.maxEvents) };
}

export function setSlot(state: SessionState, key: SlotKey, slot: Slot<string>): SessionState {
  return { ...state, slots: { ...state.slots, [key]: slot } };
}

export function setGmail(state: SessionState, gmail: GmailState): SessionState {
  return { ...state, gmail };
}

export function setCall(state: SessionState, call: CallState): SessionState {
  return { ...state, call };
}

export function beginCallAttempt(state: SessionState): SessionState {
  return { ...state, callAttempts: state.callAttempts + 1 };
}

export function setTurnPending(state: SessionState, turnPending: boolean): SessionState {
  return { ...state, turnPending };
}

export function markNudge(state: SessionState, key: keyof SessionState["nudges"]): SessionState {
  return { ...state, nudges: { ...state.nudges, [key]: true } };
}

function isSettled(slot: Slot<string>): boolean {
  return slot.status === "filled" || slot.status === "defaulted";
}

export function recordInvalidAttempt(state: SessionState, key: SlotKey): SessionState {
  if (isSettled(state.slots[key])) return state;
  const attempts = state.invalidAttempts[key] + 1;
  const next = { ...state, invalidAttempts: { ...state.invalidAttempts, [key]: attempts } };
  return attempts >= CONFIG.limits.maxSlotAttempts
    ? setSlot(next, key, { status: "parked", attempts })
    : next;
}

export function graduate(state: SessionState, now: number): SessionState {
  if (state.graduatedAt !== null) return state;
  const agentName = isSettled(state.slots.agentName)
    ? state.slots.agentName
    : ({ status: "defaulted", value: DEFAULT_AGENT_NAME } as const);
  return { ...state, graduatedAt: now, slots: { ...state.slots, agentName } };
}
