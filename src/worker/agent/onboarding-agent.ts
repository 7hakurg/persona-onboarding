import { Agent, callable, type Connection } from "agents";
import type { CallEndReason, CardData, ChatMessage, SessionState } from "../../shared/types";
import type { AcceptCallResult, RpcResult } from "../../shared/rpc";
import { CONFIG } from "../config";
import { runChatTurn } from "../conductor/chat-turn";
import { GREETING_TEXT, idleNudge } from "../conductor/prompts";
import type { Effect } from "../conductor/tools";
import type { Env } from "../env";
import { requireSecret } from "../env";
import { createFakeLlm } from "../llm/fake-llm";
import { createOpenAiClient } from "../llm/llm-client";
import type { LlmClient } from "../llm/types";
import { slidingWindow } from "../limits/rate-window";
import { log } from "../log";
import { createInitialState } from "../state/initial";
import { mergeTurnResult } from "../state/merge";
import { appendEvent, appendMessage, markNudge, setTurnPending } from "../state/reducers";
import { isCallLive } from "../state/selectors";
import { CallController, type ScheduledCallback } from "../live/call-controller";
import { createCallHost } from "./call-host";
import { applyGmailCompletion } from "../gmail/apply";
import type { GmailCompletion } from "../gmail/completion";
import { composeInsight } from "../gmail/insight";
import { slotValue } from "../state/selectors";
import { TurnQueue } from "./turn-queue";

const CHAT_WINDOW_KEY = "chat-window";
const LAST_ACTIVITY_KEY = "last-activity";
const GMAIL_NONCES_KEY = "gmail-nonces";
const MAX_PENDING_NONCES = 5;
const CLIENT_END_REASONS: ReadonlySet<CallEndReason> = new Set(["user_hangup", "page_closed", "mic_denied", "connection_failed"]);

export class OnboardingAgent extends Agent<Env, SessionState> {
  override initialState: SessionState = createInitialState(Date.now());
  private readonly turns = new TurnQueue(() => this.runTurn(), CONFIG.timing.turnDebounceMs);
  private cachedLlm: LlmClient | null = null;
  private readonly calls = new CallController(createCallHost(this, this.env));

  // ---- framework hooks -------------------------------------------------

  override validateStateChange(_next: SessionState, source: Connection | "server"): void {
    if (source !== "server") throw new Error("State is read-only for clients");
  }

  override async onStart(): Promise<void> {
    await this.calls.recoverAfterRestart();
  }

  override async onConnect(): Promise<void> {
    await this.ensureGreeted();
  }

  // ---- client RPC --------------------------------------------------------

  @callable()
  async sendMessage(raw: unknown): Promise<RpcResult> {
    if (typeof raw !== "string") return { ok: false, error: "empty" };
    const text = raw.trim();
    if (text === "") return { ok: false, error: "empty" };
    if (text.length > CONFIG.limits.maxMessageChars) return { ok: false, error: "too_long" };
    if (!(await this.allowChatMessage())) return { ok: false, error: "rate_limited" };
    const now = Date.now();
    await this.ctx.storage.put(LAST_ACTIVITY_KEY, now);
    this.update((s) => setTurnPending(appendMessage(s, { id: crypto.randomUUID(), at: now, role: "user", kind: "text", text }), true));
    this.turns.request();
    return { ok: true };
  }

  @callable()
  async requestCall(): Promise<RpcResult> {
    const result = await this.calls.ring();
    if (result.ok) this.say("Calling you now 📞");
    return result;
  }

  @callable()
  async acceptCall(sdp: unknown): Promise<AcceptCallResult> {
    return this.calls.accept(sdp);
  }

  @callable()
  async declineCall(): Promise<RpcResult> {
    await this.calls.decline();
    return { ok: true };
  }

  @callable()
  async endCall(reason: unknown): Promise<RpcResult> {
    if (typeof reason !== "string" || !CLIENT_END_REASONS.has(reason as CallEndReason)) return { ok: false, error: "invalid" };
    await this.calls.hangup(reason as CallEndReason);
    return { ok: true };
  }

  // ---- server-side API (DO RPC, not exposed to browsers) ---------------------

  async onRingTimeout(payload: { callId: string }): Promise<void> {
    await this.calls.onRingTimeout(payload);
  }

  async onMaxDuration(payload: { callId: string }): Promise<void> {
    await this.calls.onMaxDuration(payload);
  }

  async onGoodbyeTimeout(payload: { callId: string }): Promise<void> {
    await this.calls.onGoodbyeTimeout(payload);
  }

  async beginGmail(nonce: string, exp: number): Promise<void> {
    const now = Date.now();
    const pending = (await this.ctx.storage.get<Record<string, number>>(GMAIL_NONCES_KEY)) ?? {};
    const live = Object.entries(pending).filter(([, e]) => e > now).slice(-(MAX_PENDING_NONCES - 1));
    await this.ctx.storage.put(GMAIL_NONCES_KEY, Object.fromEntries([...live, [nonce, exp]]));
  }

  async hasPendingGmailNonce(nonce: string): Promise<boolean> {
    const pending = (await this.ctx.storage.get<Record<string, number>>(GMAIL_NONCES_KEY)) ?? {};
    return (pending[nonce] ?? 0) > Date.now();
  }

  /** Consumes the nonce (single use) and applies the outcome. Returns false for replays/expired links. */
  async completeGmail(result: GmailCompletion): Promise<boolean> {
    const pending = (await this.ctx.storage.get<Record<string, number>>(GMAIL_NONCES_KEY)) ?? {};
    if ((pending[result.nonce] ?? 0) <= Date.now()) return false;
    const { [result.nonce]: _used, ...rest } = pending;
    await this.ctx.storage.put(GMAIL_NONCES_KEY, rest);
    const insight = result.outcome === "connected" ? await composeInsight(this.llm(), result.snapshot, slotValue(this.state.slots.helpGoal)) : null;
    const out = applyGmailCompletion(this.state, result, insight, { now: Date.now(), newId: () => crypto.randomUUID() });
    this.setState(out.state);
    this.calls.notifyExternalChange(out.callNote);
    return true;
  }

  async scheduleCallback(delaySeconds: number, callback: ScheduledCallback, payload: { callId: string }): Promise<void> {
    await this.schedule(delaySeconds, callback, payload);
  }

  async ensureGreeted(): Promise<void> {
    if (this.state.messages.length > 0) return;
    this.say(GREETING_TEXT);
  }

  snapshot(): SessionState {
    return this.state;
  }

  async whenIdle(): Promise<void> {
    await this.turns.whenIdle();
  }

  turnCount(): number {
    return this.turns.count;
  }

  tryClientStateWrite(): "rejected" | "accepted" {
    try {
      this.validateStateChange(this.state, {} as Connection);
      return "accepted";
    } catch {
      return "rejected";
    }
  }

  async idleCheck(payload: { lastActivityAt: number }): Promise<void> {
    const last = (await this.ctx.storage.get<number>(LAST_ACTIVITY_KEY)) ?? 0;
    const s = this.state;
    if (last > payload.lastActivityAt || s.nudges.idle || s.graduatedAt !== null || isCallLive(s) || s.turnPending) return;
    this.update((st) => markNudge(st, "idle"));
    this.say(idleNudge(this.state));
  }

  // ---- internals ------------------------------------------------------------

  protected update(fn: (s: SessionState) => SessionState): void {
    this.setState(fn(this.state));
  }

  say(text: string, data?: CardData): void {
    const message: ChatMessage = { id: crypto.randomUUID(), at: Date.now(), role: "assistant", kind: data ? "card" : "text", text, ...(data ? { data } : {}) };
    this.update((s) => appendMessage(s, message));
  }

  llm(): LlmClient {
    if (this.cachedLlm) return this.cachedLlm;
    this.cachedLlm =
      this.env.FAKE_LLM === "1"
        ? createFakeLlm()
        : createOpenAiClient({ apiKey: requireSecret(this.env, "OPENAI_API_KEY"), model: CONFIG.models.chat, reasoningEffort: CONFIG.models.chatReasoningEffort });
    return this.cachedLlm;
  }

  private async allowChatMessage(): Promise<boolean> {
    const hits = (await this.ctx.storage.get<number[]>(CHAT_WINDOW_KEY)) ?? [];
    const r = slidingWindow(hits, Date.now(), CONFIG.limits.chatMessagesPerWindow, CONFIG.limits.chatWindowMs);
    await this.ctx.storage.put(CHAT_WINDOW_KEY, r.hits);
    if (!r.allowed) log("warn", "chat_rate_limited", { session: this.name });
    return r.allowed;
  }

  private async runTurn(): Promise<void> {
    const before = this.state;
    const out = await runChatTurn(before, { llm: this.llm(), now: () => Date.now(), newId: () => crypto.randomUUID() });
    this.setState(setTurnPending(mergeTurnResult(this.state, before, out.state), false));
    for (const effect of out.effects) await this.applyEffect(effect);
    await this.scheduleIdleCheck();
  }

  protected async applyEffect(effect: Effect): Promise<void> {
    switch (effect.type) {
      case "post_gmail_card":
        this.say("Tap to connect Gmail — read-only, and you can disconnect anytime.", { card: "gmail", status: "pending" });
        return;
      case "ring":
        await this.calls.ring();
        return;
      case "graduated":
        this.update((s) => appendEvent(s, { at: Date.now(), type: "graduated", detail: "" }));
        return;
      case "end_call":
        return;
    }
  }

  private async scheduleIdleCheck(): Promise<void> {
    const lastActivityAt = (await this.ctx.storage.get<number>(LAST_ACTIVITY_KEY)) ?? 0;
    await this.schedule(Math.round(CONFIG.timing.idleNudgeMs / 1000), "idleCheck", { lastActivityAt });
  }
}
