import { z } from "zod";
import type { SessionState } from "../../shared/types";
import { CONFIG } from "../config";
import { liveInstructions, voiceBackendInstructions } from "../conductor/prompts";
import { toolDefinitions } from "../conductor/tools";
import type { FunctionTool } from "../llm/types";

export class LiveApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LiveApiError";
  }
}

interface SeedMessage {
  type: "message";
  role: "user" | "assistant";
  content: { type: "input_text" | "output_text"; text: string }[];
}

export interface LiveSessionConfig {
  model: string;
  instructions: string;
  input: SeedMessage[];
  audio: { output: { voice: string } };
  delegation: {
    type: "responses";
    responses: {
      model: string;
      instructions: string;
      tools: FunctionTool[];
      tool_choice: "auto";
      reasoning: { effort: string };
    };
  };
}

function seedHistory(state: SessionState): SeedMessage[] {
  return state.messages
    .filter((m) => m.kind === "text" && (m.role === "user" || m.role === "assistant"))
    .slice(-CONFIG.history.liveSeedMessages)
    .map((m) => ({
      type: "message" as const,
      role: m.role as "user" | "assistant",
      content: [{ type: m.role === "user" ? ("input_text" as const) : ("output_text" as const), text: m.text }],
    }));
}

export function backendSettings(state: SessionState): LiveSessionConfig["delegation"]["responses"] {
  return {
    model: CONFIG.models.liveBackend,
    instructions: voiceBackendInstructions(state),
    tools: toolDefinitions("voice"),
    tool_choice: "auto",
    reasoning: { effort: CONFIG.models.chatReasoningEffort },
  };
}

export function buildSessionConfig(state: SessionState): LiveSessionConfig {
  return {
    model: CONFIG.models.live,
    instructions: liveInstructions(state),
    input: seedHistory(state),
    audio: { output: { voice: CONFIG.models.liveVoice } },
    delegation: { type: "responses", responses: backendSettings(state) },
  };
}

const CreateResponse = z.object({
  session: z.object({ id: z.string().min(1) }),
  transport: z.object({ sdp: z.string().min(1) }),
});

export interface CreateLiveSessionArgs {
  apiKey: string;
  sdp: string;
  state: SessionState;
  fetchImpl?: typeof fetch;
}

export async function createLiveSession(args: CreateLiveSessionArgs): Promise<{ sessionId: string; answerSdp: string }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl(`${CONFIG.openai.baseUrl}/live/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session: buildSessionConfig(args.state), transport: { type: "webrtc", sdp: args.sdp } }),
    signal: AbortSignal.timeout(CONFIG.openai.requestTimeoutMs),
  });
  if (!res.ok) throw new LiveApiError(res.status, `Live session creation failed (${res.status})`);
  const parsed = CreateResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new LiveApiError(res.status, "Live session response was malformed");
  return { sessionId: parsed.data.session.id, answerSdp: parsed.data.transport.sdp };
}
