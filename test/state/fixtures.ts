import { createInitialState } from "../../src/worker/state/initial";
import type { SessionState } from "../../src/shared/types";

export const NOW = 1_790_000_000_000;

export function filled<T>(value: T, source: "text" | "voice" = "text") {
  return { status: "filled" as const, value, source, at: NOW };
}

export function stateWith(patch: Partial<SessionState> = {}): SessionState {
  return { ...createInitialState(NOW), ...patch };
}

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}
