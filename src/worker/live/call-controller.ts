import type { AcceptCallResult, RpcResult } from "../../shared/rpc";
import type { CallEndReason, CardData, SessionState } from "../../shared/types";
import { CONFIG } from "../config";
import { liveGreeting, voiceBackendInstructions } from "../conductor/prompts";
import { executeTool, type Effect } from "../conductor/tools";
import type { LlmClient } from "../llm/types";
import { errorFields, log } from "../log";
import { appendEvent, beginCallAttempt, setCall } from "../state/reducers";
import { isCallLive } from "../../shared/selectors";
import type { LiveEvent } from "./events";
import { applyExtracted, composeFollowup, extractFromTranscript } from "./post-call";
import { commands, type SidebandHandlers, type SidebandLike } from "./sideband";
import { TranscriptBuffer } from "./transcript";

export type ScheduledCallback = "onRingTimeout" | "onMaxDuration" | "onGoodbyeTimeout";

/** Everything the controller needs from its Durable Object, injectable for tests. */
export interface CallHost {
  getState(): SessionState;
  setState(next: SessionState): void;
  say(text: string, data?: CardData): void;
  llm(): LlmClient;
  schedule(delayMs: number, callback: ScheduledCallback, payload: { callId: string }): Promise<void>;
  keepAlive(): Promise<() => void>;
  budget: { hasCapacity(): Promise<boolean>; record(seconds: number): Promise<void> };
  createSession(sdp: string, state: SessionState): Promise<{ sessionId: string; answerSdp: string }>;
  openSideband(sessionId: string, handlers: SidebandHandlers): Promise<SidebandLike>;
  now(): number;
  newId(): string;
  sleep(ms: number): Promise<void>;
}

interface Runtime {
  callId: string;
  sideband: SidebandLike | null;
  transcript: TranscriptBuffer;
  handledCalls: Set<string>;
  release: (() => void) | null;
}

const CLOSE_REASONS: Record<string, CallEndReason> = {
  remote_hangup: "user_hangup",
  close_requested: "user_hangup",
  connection_lost: "dropped",
  expired: "max_duration",
  content: "moderated",
};

const MAX_SDP_CHARS = 20_000;

function currentCallId(state: SessionState): string | null {
  return state.call.status === "idle" ? null : state.call.callId;
}

export class CallController {
  private runtime: Runtime | null = null;
  /** Set synchronously so a second ring() arriving during the budget RPC is refused. */
  private ringInFlight = false;

  constructor(private readonly host: CallHost) {}

  // ---- lifecycle entry points ----------------------------------------------

  async ring(): Promise<RpcResult> {
    const state = this.host.getState();
    if (isCallLive(state) || this.ringInFlight) return { ok: false, error: "call_in_progress" };
    if (state.callAttempts >= CONFIG.limits.callsPerSession) return { ok: false, error: "unavailable" };
    this.ringInFlight = true;
    try {
      return await this.startRinging();
    } finally {
      this.ringInFlight = false;
    }
  }

  private async startRinging(): Promise<RpcResult> {
    if (!(await this.host.budget.hasCapacity())) {
      this.host.say("Calls are taking a quick break right now — let's keep going over text instead. 🙂");
      this.event("call:budget_exhausted", "");
      return { ok: false, error: "unavailable" };
    }
    if (isCallLive(this.host.getState())) return { ok: false, error: "call_in_progress" };
    const callId = this.host.newId();
    this.host.setState(setCall(beginCallAttempt(this.host.getState()), { status: "ringing", callId, since: this.host.now() }));
    this.event("call:ringing", callId);
    await this.host.schedule(CONFIG.limits.ringTimeoutMs, "onRingTimeout", { callId });
    return { ok: true };
  }

  async accept(sdp: unknown): Promise<AcceptCallResult> {
    const state = this.host.getState();
    if (state.call.status !== "ringing") return { ok: false, error: isCallLive(state) ? "call_in_progress" : "no_call" };
    if (typeof sdp !== "string" || !sdp.includes("m=audio") || sdp.length > MAX_SDP_CHARS) return { ok: false, error: "invalid" };
    const callId = state.call.callId;
    this.host.setState(setCall(state, { status: "connecting", callId, since: this.host.now() }));
    this.event("call:accepted", callId);
    if (!(await this.host.budget.hasCapacity())) {
      await this.finish(callId, "budget_exhausted");
      return { ok: false, error: "unavailable" };
    }
    let created: { sessionId: string; answerSdp: string };
    try {
      created = await this.host.createSession(sdp, this.host.getState());
    } catch (err) {
      log("error", "live_session_create_failed", errorFields(err));
      await this.finish(callId, "connection_failed");
      return { ok: false, error: "unavailable" };
    }
    return this.activate(callId, created);
  }

  async decline(): Promise<void> {
    const state = this.host.getState();
    if (state.call.status === "ringing") await this.finish(state.call.callId, "declined");
  }

  async hangup(reason: CallEndReason): Promise<void> {
    const callId = currentCallId(this.host.getState());
    if (callId) await this.finish(callId, reason);
  }

  async onRingTimeout(payload: { callId: string }): Promise<void> {
    const state = this.host.getState();
    if (state.call.status === "ringing" && state.call.callId === payload.callId) await this.finish(payload.callId, "no_answer");
  }

  async onMaxDuration(payload: { callId: string }): Promise<void> {
    await this.finish(payload.callId, "max_duration");
  }

  async onGoodbyeTimeout(payload: { callId: string }): Promise<void> {
    await this.finish(payload.callId, "completed");
  }

  /** Something changed outside the call (e.g. Gmail connected): let the live model know. */
  notifyExternalChange(note: string): void {
    const sb = this.runtime?.sideband;
    if (!sb) return;
    sb.send(commands.thinking(note));
    sb.send(commands.updateBackend({ instructions: voiceBackendInstructions(this.host.getState()) }));
  }

  /**
   * After a Durable Object restart the in-memory runtime is gone; a live call cannot be resumed.
   * Runs inside onStart (blockConcurrencyWhile), so only the state transition is awaited —
   * the follow-up (budget + model call) continues in the background.
   */
  async recoverAfterRestart(): Promise<void> {
    const state = this.host.getState();
    if (this.runtime) return;
    if (state.call.status === "connecting" || state.call.status === "active") {
      this.finish(state.call.callId, "dropped").catch((err: unknown) => log("error", "restart_recovery_failed", errorFields(err)));
    }
  }

  // ---- internals -------------------------------------------------------------

  private async activate(callId: string, created: { sessionId: string; answerSdp: string }): Promise<AcceptCallResult> {
    const state = this.host.getState();
    if (state.call.status !== "connecting" || state.call.callId !== callId) {
      void this.closeOrphan(created.sessionId);
      return { ok: false, error: "no_call" };
    }
    const now = this.host.now();
    this.host.setState(setCall(state, { status: "active", callId, liveSessionId: created.sessionId, since: now, usedSeconds: 0 }));
    this.event("call:active", created.sessionId);
    this.runtime = { callId, sideband: null, transcript: new TranscriptBuffer(), handledCalls: new Set(), release: await this.host.keepAlive() };
    await this.host.schedule(CONFIG.limits.maxCallMs, "onMaxDuration", { callId });
    void this.attach(callId, created.sessionId);
    return { ok: true, answerSdp: created.answerSdp };
  }

  private async attach(callId: string, sessionId: string): Promise<void> {
    const handlers: SidebandHandlers = {
      onEvent: (e) => this.onEvent(callId, e),
      onClosed: () => void this.finish(callId, "dropped"),
    };
    for (let attempt = 0; attempt < CONFIG.timing.sidebandAttachRetries; attempt++) {
      try {
        const sb = await this.host.openSideband(sessionId, handlers);
        if (this.runtime?.callId !== callId) {
          sb.send(commands.close());
          sb.close();
          return;
        }
        this.runtime.sideband = sb;
        sb.send(commands.instructions(liveGreeting(this.host.getState())));
        return;
      } catch (err) {
        log("warn", "sideband_attach_failed", { attempt, ...errorFields(err) });
        await this.host.sleep(250 * 2 ** attempt);
      }
    }
    await this.finish(callId, "connection_failed");
  }

  private async closeOrphan(sessionId: string): Promise<void> {
    try {
      const sb = await this.host.openSideband(sessionId, { onEvent: () => {}, onClosed: () => {} });
      sb.send(commands.close());
    } catch (err) {
      log("warn", "orphan_close_failed", errorFields(err));
    }
  }

  private onEvent(callId: string, e: LiveEvent): void {
    const rt = this.runtime;
    if (!rt || rt.callId !== callId) return;
    switch (e.kind) {
      case "transcript":
        rt.transcript.add(e.speaker, e.delta);
        return;
      case "function_call":
        this.runTool(rt, e.callId, e.name, e.argsJson);
        return;
      case "usage":
        this.recordUsage(callId, e.seconds);
        return;
      case "closed":
        void this.finish(callId, CLOSE_REASONS[e.reason] ?? "dropped");
        return;
      case "error":
        log("warn", "live_error", { code: e.code, detail: e.message.slice(0, 200) });
        return;
      default:
        return;
    }
  }

  private runTool(rt: Runtime, toolCallId: string, name: string, argsJson: string): void {
    if (rt.handledCalls.has(toolCallId)) return;
    rt.handledCalls.add(toolCallId);
    const out = executeTool(this.host.getState(), { name, argsJson, channel: "voice", now: this.host.now() });
    this.host.setState(out.state);
    for (const cmd of commands.toolResult(toolCallId, out.result)) rt.sideband?.send(cmd);
    rt.sideband?.send(commands.updateBackend({ instructions: voiceBackendInstructions(out.state) }));
    for (const effect of out.effects) void this.applyEffect(rt.callId, effect);
  }

  private async applyEffect(callId: string, effect: Effect): Promise<void> {
    if (effect.type === "post_gmail_card") {
      this.host.say("Here's the Gmail button — tap it whenever you're ready (we can keep talking).", { card: "gmail", status: "pending" });
    } else if (effect.type === "end_call" || effect.type === "graduated") {
      await this.host.schedule(CONFIG.timing.goodbyeGraceMs, "onGoodbyeTimeout", { callId });
    }
  }

  private recordUsage(callId: string, seconds: number): void {
    const state = this.host.getState();
    if (state.call.status === "active" && state.call.callId === callId) {
      this.host.setState(setCall(state, { ...state.call, usedSeconds: seconds }));
    }
  }

  private async finish(callId: string, reason: CallEndReason): Promise<void> {
    const state = this.host.getState();
    if (!isCallLive(state) || currentCallId(state) !== callId) return;
    const call = state.call;
    const rt = this.runtime?.callId === callId ? this.runtime : null;
    if (rt) this.runtime = null;
    const now = this.host.now();
    const durationMs = call.status === "active" ? now - call.since : 0;
    this.host.setState(setCall(state, { status: "ended", callId, reason, at: now, durationMs }));
    this.event("call:ended", reason);
    if (rt?.sideband) {
      rt.sideband.send(commands.close());
    }
    rt?.release?.();
    if (call.status === "active" && call.usedSeconds > 0) await this.host.budget.record(call.usedSeconds);
    const transcript = rt?.transcript ?? null;
    this.host.say(reason === "declined" || reason === "no_answer" ? "Missed call" : "Call ended", { card: "call", outcome: reason, durationMs, transcript: transcript?.lines() ?? [] });
    await this.afterCall(reason, transcript);
  }

  private async afterCall(reason: CallEndReason, transcript: TranscriptBuffer | null): Promise<void> {
    const llm = this.host.llm();
    if (transcript?.hasUserSpeech()) {
      try {
        const facts = await extractFromTranscript(llm, transcript.asText());
        this.host.setState(applyExtracted(this.host.getState(), facts, this.host.now()));
      } catch (err) {
        log("warn", "extraction_failed", errorFields(err));
      }
    }
    this.host.say(await composeFollowup(llm, this.host.getState(), reason));
  }

  private event(type: string, detail: string): void {
    this.host.setState(appendEvent(this.host.getState(), { at: this.host.now(), type, detail }));
  }
}
