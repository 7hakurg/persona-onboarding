import { CONFIG } from "../config";
import { errorFields, log } from "../log";
import { parseLiveEvent, type LiveEvent } from "./events";

export interface LiveCommand {
  type: string;
  [key: string]: unknown;
}

export interface SidebandHandlers {
  onEvent(event: LiveEvent): void;
  onClosed(): void;
}

export interface SidebandLike {
  send(command: LiveCommand): void;
  close(): void;
}

export interface OpenSidebandArgs {
  apiKey: string;
  sessionId: string;
  handlers: SidebandHandlers;
  fetchImpl?: typeof fetch;
}

/** Server-side control connection to a running GPT-Live session. */
export async function openSideband(args: OpenSidebandArgs): Promise<SidebandLike> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${CONFIG.openai.baseUrl}/live/sessions/${encodeURIComponent(args.sessionId)}/attach`;
  const res = await fetchImpl(url, { headers: { Upgrade: "websocket", Authorization: `Bearer ${args.apiKey}` } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`Sideband attach failed (${res.status})`);
  ws.accept();
  let open = true;
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") args.handlers.onEvent(parseLiveEvent(e.data));
  });
  const onDone = () => {
    if (!open) return;
    open = false;
    args.handlers.onClosed();
  };
  ws.addEventListener("close", onDone);
  ws.addEventListener("error", onDone);
  return {
    send(command) {
      if (!open) return;
      try {
        ws.send(JSON.stringify(command));
      } catch (err) {
        log("warn", "sideband_send_failed", { type: command.type, ...errorFields(err) });
      }
    },
    close() {
      if (!open) return;
      open = false;
      try {
        ws.close(1000, "done");
      } catch {
        // already closed
      }
    },
  };
}

export const commands = {
  toolResult: (callId: string, output: unknown): LiveCommand[] => [
    { type: "response.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } },
    { type: "response.create" },
  ],
  instructions: (content: string): LiveCommand => ({ type: "session.instructions.append", delegation_id: null, content }),
  thinking: (content: string): LiveCommand => ({ type: "session.thinking.append", delegation_id: null, content }),
  // GPT-Live requires the delegation type on every update, even when it is unchanged.
  updateBackend: (responses: Record<string, unknown>): LiveCommand => ({ type: "session.update", session: { delegation: { type: "responses", responses } } }),
  close: (): LiveCommand => ({ type: "session.close" }),
};
