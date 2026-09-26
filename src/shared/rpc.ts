/** Result of a client-invoked RPC. Errors are user-actionable codes the UI maps to copy. */
export type RpcError = "rate_limited" | "too_long" | "empty" | "call_in_progress" | "no_call" | "unavailable" | "invalid";

export type RpcResult = { ok: true } | { ok: false; error: RpcError };

export type AcceptCallResult = { ok: true; answerSdp: string } | { ok: false; error: RpcError };

export const AGENT_NAMESPACE = "onboarding-agent";
export const SELF_SESSION_NAME = "me";
