import type { RpcError } from "../../shared/rpc";

export const ERROR_COPY: Record<RpcError, string> = {
  rate_limited: "Whoa, that's a lot of messages — give it a few minutes.",
  too_long: "That message is a bit long — try keeping it under 1,000 characters.",
  empty: "Type something first 🙂",
  call_in_progress: "A call is already in progress.",
  no_call: "That call already ended.",
  unavailable: "That didn't go through — check your connection and try again.",
  invalid: "Something went wrong with that request.",
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
