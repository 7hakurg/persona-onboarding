import type { CardData, ChatMessage, SessionState } from "../../shared/types";
import { slotValue } from "../../shared/selectors";
import type { FunctionTool, LlmClient } from "../llm/types";
import { errorFields, log } from "../log";
import { appendEvent, setGmail, updateMessageData } from "../state/reducers";
import { draftReplyBody, summarizeThread, triageThreads } from "./ai";
import type { GmailClient } from "./client";
import { GoogleError } from "./google";
import { GmailAuthRevokedError } from "./token-store";
import { GMAIL_TOOL_ARGS, GMAIL_TOOLS, MAX_ARCHIVE, isGmailTool, type GmailToolName } from "./tool-schemas";

export type GmailApi = Pick<GmailClient, "searchThreads" | "getThread" | "archive" | "unarchive" | "createReplyDraft">;

export interface GmailHost {
  getState(): SessionState;
  setState(next: SessionState): void;
  say(text: string, data?: CardData): void;
  llm(): LlmClient;
  now(): number;
  /** Per-session limiter for Gmail side effects. */
  allowAction(): Promise<boolean>;
  /** Deletes stored credentials and revokes them at Google. */
  forgetCredentials(): Promise<void>;
}

export interface GmailToolOutcome {
  result: Record<string, unknown>;
  cards: ChatMessage[];
}

const TRIAGE_QUERY = "is:unread newer_than:7d -category:promotions -category:social";
const TRIAGE_COUNT = 5;
const SEARCH_LIMIT = 10;

function gmailDraftsUrl(email: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts`;
}

/** Inbox help after onboarding: triage, search, summaries, undoable archive, and reply drafts (never sends). */
export class GmailAssistant {
  constructor(
    private readonly host: GmailHost,
    private readonly api: () => GmailApi,
  ) {}

  canManage(state: SessionState = this.host.getState()): boolean {
    return state.gmail.status === "connected" && state.gmail.canManage === true;
  }

  toolDefinitions(): FunctionTool[] {
    return this.canManage() ? GMAIL_TOOLS : [];
  }

  /** Right after connecting: the "What needs you" card. */
  async onConnected(): Promise<void> {
    if (!this.canManage()) return;
    try {
      const list = await this.api().searchThreads(TRIAGE_QUERY, TRIAGE_COUNT);
      if (list.length === 0) {
        this.host.say("Nothing unread is waiting on you this week. 🎉 Ask me anytime to search, summarize, or draft replies.");
        return;
      }
      const threads = await Promise.all(list.map((t) => this.api().getThread(t.id)));
      const items = await triageThreads(this.host.llm(), threads, slotValue(this.host.getState().slots.helpGoal));
      this.host.say("Here's what needs you — I can draft replies or clear the rest.", { card: "triage", items });
    } catch (err) {
      await this.handleError(err);
    }
  }

  async runTool(name: string, argsJson: string): Promise<GmailToolOutcome> {
    if (!isGmailTool(name)) return { result: { ok: false, error: "unknown_tool" }, cards: [] };
    if (!this.canManage()) return { result: { ok: false, error: "gmail_not_connected" }, cards: [] };
    const parsed = GMAIL_TOOL_ARGS[name].safeParse(safeJson(argsJson));
    if (!parsed.success) return { result: { ok: false, error: "invalid_arguments" }, cards: [] };
    try {
      return await this.dispatch(name, parsed.data as never);
    } catch (err) {
      return { result: { ok: false, error: await this.handleError(err) }, cards: [] };
    }
  }

  /** Button on a triage card. */
  async draftFromUi(threadId: string, instructions: string): Promise<void> {
    const out = await this.runTool("gmail_draft_reply", JSON.stringify({ thread_id: threadId, instructions }));
    this.postCards(out);
  }

  /** Button on a triage card. */
  async archiveFromUi(threadIds: string[]): Promise<void> {
    const out = await this.runTool("gmail_archive", JSON.stringify({ thread_ids: threadIds }));
    this.postCards(out);
  }

  async undoArchive(messageId: string): Promise<void> {
    const msg = this.host.getState().messages.find((m) => m.id === messageId);
    if (msg?.data?.card !== "archived" || msg.data.undone) return;
    const data = msg.data;
    this.host.setState(updateMessageData(this.host.getState(), messageId, { ...data, undone: true }));
    try {
      await this.api().unarchive(data.threadIds);
    } catch (err) {
      this.host.setState(updateMessageData(this.host.getState(), messageId, data));
      await this.handleError(err);
    }
  }

  async disconnect(): Promise<void> {
    await this.host.forgetCredentials();
    this.host.setState(appendEvent(setGmail(this.host.getState(), { status: "not_connected" }), { at: this.host.now(), type: "gmail:disconnected", detail: "" }));
    this.host.say("Disconnected Gmail and revoked my access. You can reconnect anytime.");
  }

  // ---- internals -----------------------------------------------------------

  private async dispatch(name: GmailToolName, args: never): Promise<GmailToolOutcome> {
    switch (name) {
      case "gmail_search":
        return this.search(args);
      case "gmail_summarize_thread":
        return this.summarize(args);
      case "gmail_archive":
        return this.archive(args);
      case "gmail_draft_reply":
        return this.draft(args);
    }
  }

  private async search(args: { query: string }): Promise<GmailToolOutcome> {
    const threads = await this.api().searchThreads(args.query, SEARCH_LIMIT);
    return { result: { ok: true, threads }, cards: [] };
  }

  private async summarize(args: { thread_id: string }): Promise<GmailToolOutcome> {
    const thread = await this.api().getThread(args.thread_id);
    return { result: { ok: true, subject: thread.subject, summary: await summarizeThread(this.host.llm(), thread) }, cards: [] };
  }

  private async archive(args: { thread_ids: string[] }): Promise<GmailToolOutcome> {
    if (args.thread_ids.length > MAX_ARCHIVE) return { result: { ok: false, error: "too_many_threads", max: MAX_ARCHIVE }, cards: [] };
    if (!(await this.host.allowAction())) return { result: { ok: false, error: "rate_limited" }, cards: [] };
    const ids = [...new Set(args.thread_ids)];
    await this.api().archive(ids);
    const data: CardData = { card: "archived", threadIds: ids, count: ids.length, undone: false };
    return { result: { ok: true, archived: ids.length, undoable: true }, cards: [this.card(`Archived ${ids.length} thread${ids.length === 1 ? "" : "s"}.`, data)] };
  }

  private async draft(args: { thread_id: string; instructions: string }): Promise<GmailToolOutcome> {
    if (!(await this.host.allowAction())) return { result: { ok: false, error: "rate_limited" }, cards: [] };
    const state = this.host.getState();
    if (state.gmail.status !== "connected") return { result: { ok: false, error: "gmail_not_connected" }, cards: [] };
    const thread = await this.api().getThread(args.thread_id);
    const body = await draftReplyBody(this.host.llm(), thread, args.instructions, slotValue(state.slots.userName));
    const draft = await this.api().createReplyDraft(thread, state.gmail.email, body);
    const data: CardData = { card: "draft", threadId: thread.id, to: draft.to, subject: draft.subject, body, gmailUrl: gmailDraftsUrl(state.gmail.email) };
    return { result: { ok: true, sent: false, draft: { to: draft.to, subject: draft.subject } }, cards: [this.card("Draft saved in Gmail — not sent.", data)] };
  }

  private card(text: string, data: CardData): ChatMessage {
    return { id: crypto.randomUUID(), at: this.host.now(), role: "assistant", kind: "card", text, data };
  }

  private postCards(out: GmailToolOutcome): void {
    for (const c of out.cards) this.host.say(c.text, c.data);
    if (!out.result.ok && out.result.error !== "gmail_disconnected") {
      this.host.say(out.result.error === "rate_limited" ? "Let's pause Gmail actions for a few minutes." : "That didn't work on Gmail's side — try again in a moment?");
    }
  }

  /** Maps failures to a tool error code; a revoked grant flips the session to "reconnect". */
  private async handleError(err: unknown): Promise<string> {
    if (err instanceof GmailAuthRevokedError) {
      this.host.setState(setGmail(this.host.getState(), { status: "error", reason: "revoked" }));
      this.host.say("My Gmail access expired — reconnect whenever you like.", { card: "gmail", status: "pending" });
      return "gmail_disconnected";
    }
    log("warn", "gmail_action_failed", errorFields(err));
    return err instanceof GoogleError && err.status === 404 ? "thread_not_found" : "gmail_unavailable";
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
