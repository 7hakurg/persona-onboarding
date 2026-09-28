import { describe, expect, it } from "vitest";
import type { CardData, SessionState } from "../../src/shared/types";
import { GmailAssistant, type GmailApi, type GmailHost } from "../../src/worker/gmail/assistant";
import type { ThreadDetail } from "../../src/worker/gmail/client";
import { GmailAuthRevokedError } from "../../src/worker/gmail/token-store";
import type { LlmClient } from "../../src/worker/llm/types";
import { createInitialState } from "../../src/worker/state/initial";
import { appendMessage, setGmail } from "../../src/worker/state/reducers";
import { NOW } from "../state/fixtures";

const THREAD: ThreadDetail = { id: "t1", subject: "Contract", messages: [{ from: "Priya <p@x.com>", to: "sam@y.com", date: "d", text: "Sign by Friday?", messageId: "<m1@x>" }] };

class FakeApi implements GmailApi {
  archived: string[][] = [];
  unarchived: string[][] = [];
  drafts: { threadId: string; body: string }[] = [];
  fail: Error | null = null;
  async searchThreads() {
    if (this.fail) throw this.fail;
    return [{ id: "t1", from: "Priya", subject: "Contract", date: "d", unread: true, messageCount: 1 }];
  }
  async getThread() {
    if (this.fail) throw this.fail;
    return THREAD;
  }
  async archive(ids: string[]) {
    this.archived.push(ids);
  }
  async unarchive(ids: string[]) {
    this.unarchived.push(ids);
  }
  async createReplyDraft(t: ThreadDetail, _own: string, body: string) {
    this.drafts.push({ threadId: t.id, body });
    return { draftId: "d1", to: "Priya <p@x.com>", subject: "Re: Contract" };
  }
}

function setup(canManage = true) {
  const api = new FakeApi();
  const outputs: string[] = [];
  const llm: LlmClient = { respond: async () => ({ outputText: outputs.shift() ?? "{}", calls: [] }) };
  let state: SessionState = setGmail(createInitialState(NOW), { status: "connected", email: "sam@y.com", snapshot: { unreadCount: 1, topSenders: [], sampleSubjects: [] }, insight: "", canManage });
  let allowed = true;
  let forgotten = 0;
  const host: GmailHost = {
    getState: () => state,
    setState: (s) => void (state = s),
    say: (text, data) => void (state = appendMessage(state, { id: `m${state.messages.length}`, at: NOW, role: "assistant", kind: data ? "card" : "text", text, ...(data ? { data } : {}) })),
    llm: () => llm,
    now: () => NOW,
    allowAction: async () => allowed,
    forgetCredentials: async () => void (forgotten += 1),
  };
  const assistant = new GmailAssistant(host, () => api);
  return { api, assistant, outputs, state: () => state, deny: () => void (allowed = false), forgotten: () => forgotten };
}

const cards = (s: SessionState) => s.messages.flatMap((m) => (m.data ? [m.data] : [])) as CardData[];

describe("GmailAssistant", () => {
  it("posts a triage card when gmail connects", async () => {
    const t = setup();
    t.outputs.push(JSON.stringify({ items: [{ threadId: "t1", summary: "Priya needs a signature by Friday.", urgency: "high", action: "reply" }] }));
    await t.assistant.onConnected();
    expect(cards(t.state())).toContainEqual({ card: "triage", items: [expect.objectContaining({ threadId: "t1", urgency: "high", action: "reply" })] });
  });

  it("only exposes tools when it can manage the inbox", () => {
    expect(setup(true).assistant.toolDefinitions().map((t) => t.name)).toEqual(["gmail_search", "gmail_summarize_thread", "gmail_archive", "gmail_draft_reply"]);
    expect(setup(false).assistant.toolDefinitions()).toEqual([]);
  });

  it("searches", async () => {
    const out = await setup().assistant.runTool("gmail_search", JSON.stringify({ query: "from:priya" }));
    expect(out.result).toMatchObject({ ok: true, threads: [{ id: "t1", from: "Priya" }] });
  });

  it("summarizes a thread", async () => {
    const t = setup();
    t.outputs.push(JSON.stringify({ summary: "Priya wants a signature." }));
    expect((await t.assistant.runTool("gmail_summarize_thread", JSON.stringify({ thread_id: "t1" }))).result).toEqual({ ok: true, subject: "Contract", summary: "Priya wants a signature." });
  });

  it("archives with an undoable card", async () => {
    const t = setup();
    const out = await t.assistant.runTool("gmail_archive", JSON.stringify({ thread_ids: ["t1", "t2"] }));
    expect(t.api.archived).toEqual([["t1", "t2"]]);
    expect(out.cards[0]?.data).toEqual({ card: "archived", threadIds: ["t1", "t2"], count: 2, undone: false });
  });

  it("refuses oversized archive requests", async () => {
    const out = await setup().assistant.runTool("gmail_archive", JSON.stringify({ thread_ids: Array.from({ length: 26 }, (_, i) => `t${i}`) }));
    expect(out.result).toMatchObject({ ok: false, error: "too_many_threads" });
  });

  it("undoes an archive exactly once", async () => {
    const t = setup();
    await t.assistant.archiveFromUi(["t1"]);
    const card = t.state().messages.find((m) => m.data?.card === "archived")!;
    await t.assistant.undoArchive(card.id);
    await t.assistant.undoArchive(card.id);
    expect(t.api.unarchived).toEqual([["t1"]]);
    expect(t.state().messages.find((m) => m.id === card.id)?.data).toMatchObject({ undone: true });
  });

  it("drafts a reply without sending", async () => {
    const t = setup();
    t.outputs.push(JSON.stringify({ body: "Hi Priya, signed. Sam" }));
    const out = await t.assistant.runTool("gmail_draft_reply", JSON.stringify({ thread_id: "t1", instructions: "tell her it's signed" }));
    expect(t.api.drafts).toEqual([{ threadId: "t1", body: "Hi Priya, signed. Sam" }]);
    expect(out.cards[0]?.data).toMatchObject({ card: "draft", to: "Priya <p@x.com>", subject: "Re: Contract", body: "Hi Priya, signed. Sam" });
    expect(out.result).toMatchObject({ ok: true, sent: false });
  });

  it("asks to reconnect when Google revoked access", async () => {
    const t = setup();
    t.api.fail = new GmailAuthRevokedError();
    const out = await t.assistant.runTool("gmail_search", JSON.stringify({ query: "x" }));
    expect(out.result).toMatchObject({ ok: false, error: "gmail_disconnected" });
    expect(t.state().gmail).toMatchObject({ status: "error", reason: "revoked" });
  });

  it("rate limits actions", async () => {
    const t = setup();
    t.deny();
    expect((await t.assistant.runTool("gmail_archive", JSON.stringify({ thread_ids: ["t1"] }))).result).toMatchObject({ ok: false, error: "rate_limited" });
    expect(t.api.archived).toEqual([]);
  });

  it("disconnects and forgets credentials", async () => {
    const t = setup();
    await t.assistant.disconnect();
    expect(t.forgotten()).toBe(1);
    expect(t.state().gmail).toEqual({ status: "not_connected" });
  });

  it("rejects unknown tools and bad arguments", async () => {
    const t = setup();
    expect((await t.assistant.runTool("gmail_send", "{}")).result).toMatchObject({ ok: false, error: "unknown_tool" });
    expect((await t.assistant.runTool("gmail_archive", "{\"thread_ids\":\"t1\"}")).result).toMatchObject({ ok: false, error: "invalid_arguments" });
  });
});
