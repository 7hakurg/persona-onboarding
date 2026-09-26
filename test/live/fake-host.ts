import type { CardData, SessionState } from "../../src/shared/types";
import type { CallHost } from "../../src/worker/live/call-controller";
import type { LiveEvent } from "../../src/worker/live/events";
import type { LiveCommand, SidebandHandlers } from "../../src/worker/live/sideband";
import type { LlmClient, LlmRequest, LlmResponse } from "../../src/worker/llm/types";
import { createInitialState } from "../../src/worker/state/initial";
import { setSlot } from "../../src/worker/state/reducers";
import { NOW, filled } from "../state/fixtures";

export class FakeSideband {
  sent: LiveCommand[] = [];
  closed = false;
  constructor(public handlers: SidebandHandlers) {}
  send(c: LiveCommand) {
    if (!this.closed) this.sent.push(c);
  }
  close() {
    this.closed = true;
  }
  emit(e: LiveEvent) {
    this.handlers.onEvent(e);
  }
  drop() {
    this.handlers.onClosed();
  }
}

export class FakeHost implements CallHost {
  state: SessionState = setSlot(createInitialState(NOW), "agentName", filled("Jarvis"));
  said: { text: string; data?: CardData }[] = [];
  scheduled: { delayMs: number; callback: string; payload: { callId: string } }[] = [];
  createCalls = 0;
  createImpl: (sdp: string) => Promise<{ sessionId: string; answerSdp: string }> = async () => ({ sessionId: "live_1", answerSdp: "ANSWER" });
  attachFailures = 0;
  sidebands: FakeSideband[] = [];
  capacity = true;
  recorded: number[] = [];
  released = 0;
  llmResponses: LlmResponse[] = [];
  llmRequests: LlmRequest[] = [];
  clock = NOW;

  getState() {
    return this.state;
  }
  setState(next: SessionState) {
    this.state = next;
  }
  say(text: string, data?: CardData) {
    this.said.push({ text, ...(data ? { data } : {}) });
  }
  llm(): LlmClient {
    return {
      respond: async (req) => {
        this.llmRequests.push(req);
        return this.llmResponses.shift() ?? { outputText: req.json ? "{\"userName\":\"\",\"helpGoal\":\"\"}" : "Follow-up!", calls: [] };
      },
    };
  }
  async schedule(delayMs: number, callback: "onRingTimeout" | "onMaxDuration" | "onGoodbyeTimeout", payload: { callId: string }) {
    this.scheduled.push({ delayMs, callback, payload });
  }
  async keepAlive() {
    return () => {
      this.released += 1;
    };
  }
  budget = {
    hasCapacity: async () => this.capacity,
    record: async (s: number) => {
      this.recorded.push(s);
    },
  };
  async createSession(sdp: string) {
    this.createCalls += 1;
    return this.createImpl(sdp);
  }
  async openSideband(_id: string, handlers: SidebandHandlers) {
    if (this.attachFailures > 0) {
      this.attachFailures -= 1;
      throw new Error("attach failed");
    }
    const sb = new FakeSideband(handlers);
    this.sidebands.push(sb);
    return sb;
  }
  now() {
    return this.clock;
  }
  newId() {
    return `id-${Math.random()}`;
  }
  async sleep() {}
}

export const OFFER = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
export const settle = () => new Promise((r) => setTimeout(r, 10));
