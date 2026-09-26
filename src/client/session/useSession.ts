import { useAgent } from "agents/react";
import { useCallback, useEffect, useState } from "react";
import { AGENT_NAMESPACE, SELF_SESSION_NAME, type AcceptCallResult, type RpcResult } from "../../shared/rpc";
import type { SessionState } from "../../shared/types";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export interface SessionApi {
  state: SessionState | null;
  status: ConnectionStatus;
  sendMessage(text: string): Promise<RpcResult>;
  requestCall(): Promise<RpcResult>;
  acceptCall(sdp: string): Promise<AcceptCallResult>;
  declineCall(): Promise<RpcResult>;
  endCall(reason: "user_hangup" | "page_closed" | "mic_denied" | "connection_failed"): Promise<RpcResult>;
}

const UNAVAILABLE: RpcResult = { ok: false, error: "unavailable" };

export function useSession(): SessionApi {
  const [state, setState] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const agent = useAgent<SessionState>({
    agent: AGENT_NAMESPACE,
    name: SELF_SESSION_NAME,
    onStateUpdate: (next) => setState(next),
  });

  useEffect(() => {
    const onOpen = () => setStatus("open");
    const onClose = () => setStatus((s) => (s === "connecting" ? s : "reconnecting"));
    agent.addEventListener("open", onOpen);
    agent.addEventListener("close", onClose);
    return () => {
      agent.removeEventListener("open", onOpen);
      agent.removeEventListener("close", onClose);
    };
  }, [agent]);

  const invoke = useCallback(
    async <T,>(method: string, args: unknown[], fallback: T): Promise<T> => {
      try {
        return await agent.call<T>(method, args);
      } catch {
        return fallback;
      }
    },
    [agent],
  );

  return {
    state: state ?? agent.state ?? null,
    status,
    sendMessage: (text) => invoke("sendMessage", [text], UNAVAILABLE),
    requestCall: () => invoke("requestCall", [], UNAVAILABLE),
    acceptCall: (sdp) => invoke<AcceptCallResult>("acceptCall", [sdp], { ok: false, error: "unavailable" }),
    declineCall: () => invoke("declineCall", [], UNAVAILABLE),
    endCall: (reason) => invoke("endCall", [reason], UNAVAILABLE),
  };
}
