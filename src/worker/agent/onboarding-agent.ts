import { Agent, callable, type Connection } from "agents";
import type { CardData, ChatMessage, SessionState } from "../../shared/types";
import type { RpcResult } from "../../shared/rpc";
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
import { appendEvent, appendMessage, beginCallAttempt, markNudge, setCall, setTurnPending } from "../state/reducers";
import { isCallLive } from "../state/selectors";
import { TurnQueue } from "./turn-queue";

const CHAT_WINDOW_KEY = "chat-window";
const LAST_ACTIVITY_KEY = "last-activity";

export class OnboardingAgent extends Agent<Env, SessionState> {
  override initialState: SessionState = createInitialState(Date.now());
  private readonly turns = new TurnQueue(() => this.runTurn(), CONFIG.timing.turnDebounceMs);
  private cachedLlm: LlmClient | null = null;

  // ---- framework hooks -------------------------------------------------

  override validateStateChange(_next: SessionState, source: Connection | "server"): void {
    if (source !== "server") throw new Error("State is read-only for clients");
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

  // ---- server-side API (DO RPC, not exposed to browsers) ---------------------

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

  protected say(text: string, data?: CardData): void {
    const message: ChatMessage = { id: crypto.randomUUID(), at: Date.now(), role: "assistant", kind: data ? "card" : "text", text, ...(data ? { data } : {}) };
    this.update((s) => appendMessage(s, message));
  }

  protected llm(): LlmClient {
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
        await this.ring();
        return;
      case "graduated":
        this.update((s) => appendEvent(s, { at: Date.now(), type: "graduated", detail: "" }));
        return;
      case "end_call":
        return;
    }
  }

  protected async ring(): Promise<void> {
    if (isCallLive(this.state)) return;
    const callId = crypto.randomUUID();
    this.update((s) => appendEvent(setCall(beginCallAttempt(s), { status: "ringing", callId, since: Date.now() }), { at: Date.now(), type: "call:ringing", detail: callId }));
  }

  private async scheduleIdleCheck(): Promise<void> {
    const lastActivityAt = (await this.ctx.storage.get<number>(LAST_ACTIVITY_KEY)) ?? 0;
    await this.schedule(Math.round(CONFIG.timing.idleNudgeMs / 1000), "idleCheck", { lastActivityAt });
  }
}
