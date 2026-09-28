import { z } from "zod";
import { GoogleError, senderName } from "./google";
import { buildReplyRaw, extractBodyText, type MimePart } from "./mime";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 10_000;
const MAX_ARCHIVE_BATCH = 25;
const MAX_THREAD_MESSAGES = 6;

export interface TokenProvider {
  get(): Promise<string>;
  /** Drops a cached access token so the next get() refreshes it. */
  invalidate(): void;
}

export interface ThreadListItem {
  id: string;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  messageCount: number;
}

export interface ThreadMessage {
  from: string;
  to: string;
  date: string;
  text: string;
  messageId: string | null;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  messages: ThreadMessage[];
}

const Header = z.object({ name: z.string(), value: z.string() });
const Message = z.object({
  id: z.string(),
  labelIds: z.array(z.string()).default([]),
  payload: z.object({ headers: z.array(Header).default([]) }).passthrough().default({ headers: [] }),
});
const Thread = z.object({ id: z.string(), messages: z.array(Message).default([]) });
const ThreadList = z.object({ threads: z.array(z.object({ id: z.string() })).default([]) });
const Draft = z.object({ id: z.string() });

type MessageT = z.infer<typeof Message>;

function header(m: MessageT, name: string): string {
  return m.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Thin Gmail REST client. Every call goes through one authorized request with a single 401 retry. */
export class GmailClient {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async searchThreads(query: string, max: number): Promise<ThreadListItem[]> {
    const q = new URLSearchParams({ q: query, maxResults: String(max) });
    const list = ThreadList.parse(await this.request("GET", `/threads?${q}`));
    const meta = new URLSearchParams([["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "Subject"], ["metadataHeaders", "Date"]]);
    const threads = await Promise.all(list.threads.map(async (t) => Thread.parse(await this.request("GET", `/threads/${encodeURIComponent(t.id)}?${meta}`))));
    return threads.flatMap((t) => {
      const last = t.messages.at(-1);
      if (!last) return [];
      return [{ id: t.id, from: senderName(header(last, "From")), subject: header(last, "Subject") || "(no subject)", date: header(last, "Date"), unread: t.messages.some((m) => m.labelIds.includes("UNREAD")), messageCount: t.messages.length }];
    });
  }

  async getThread(id: string): Promise<ThreadDetail> {
    const t = Thread.parse(await this.request("GET", `/threads/${encodeURIComponent(id)}?format=full`));
    const first = t.messages[0];
    const messages = t.messages.slice(-MAX_THREAD_MESSAGES).map((m) => ({
      from: header(m, "From"),
      to: header(m, "To"),
      date: header(m, "Date"),
      text: extractBodyText(m.payload as MimePart),
      messageId: header(m, "Message-ID") || null,
    }));
    return { id: t.id, subject: first ? header(first, "Subject") || "(no subject)" : "(no subject)", messages };
  }

  async archive(threadIds: string[]): Promise<void> {
    await this.modify(threadIds, { removeLabelIds: ["INBOX"] });
  }

  async unarchive(threadIds: string[]): Promise<void> {
    await this.modify(threadIds, { addLabelIds: ["INBOX"] });
  }

  /** Creates (never sends) a reply draft in the thread, addressed to the other participant. */
  async createReplyDraft(thread: ThreadDetail, ownEmail: string, body: string): Promise<{ draftId: string; to: string; subject: string }> {
    const lastOther = [...thread.messages].reverse().find((m) => !m.from.toLowerCase().includes(ownEmail.toLowerCase()));
    const last = thread.messages.at(-1);
    const to = lastOther?.from || last?.to || "";
    if (!to) throw new Error("Thread has no recipient to reply to");
    const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
    const references = thread.messages.map((m) => m.messageId).filter(Boolean).join(" ") || null;
    const raw = buildReplyRaw({ to, subject, body, inReplyTo: last?.messageId ?? null, references });
    const draft = Draft.parse(await this.request("POST", "/drafts", { message: { raw, threadId: thread.id } }));
    return { draftId: draft.id, to, subject };
  }

  private async modify(threadIds: string[], body: Record<string, string[]>): Promise<void> {
    if (threadIds.length > MAX_ARCHIVE_BATCH) throw new Error(`Can modify at most ${MAX_ARCHIVE_BATCH} threads at once`);
    for (const id of threadIds) await this.request("POST", `/threads/${encodeURIComponent(id)}/modify`, body);
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    // Detach before calling: the platform fetch throws "Illegal invocation" when `this` is not globalThis.
    const doFetch = this.fetchImpl;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await doFetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.tokens.get()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 && attempt === 0) {
        this.tokens.invalidate();
        continue;
      }
      if (!res.ok) throw new GoogleError("gmail", res.status);
      return res.json();
    }
    throw new GoogleError("gmail", 401);
  }
}
