import { describe, expect, it } from "vitest";
import { GmailClient } from "../../src/worker/gmail/client";

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hdr = (h: Record<string, string>) => Object.entries(h).map(([name, value]) => ({ name, value }));

type Handler = (url: URL, init?: RequestInit) => Response;
function stub(routes: Array<[RegExp, Handler]>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const impl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ method: init?.method ?? "GET", path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes.find(([re]) => re.test(url.pathname + url.search));
    return hit ? hit[1](url, init) : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function tokens(values: string[]) {
  let invalidated = 0;
  return {
    provider: { get: async () => values[Math.min(invalidated, values.length - 1)]!, invalidate: () => void (invalidated += 1) },
    invalidations: () => invalidated,
  };
}

const THREAD = {
  id: "t1",
  messages: [
    { id: "m0", labelIds: ["INBOX"], payload: { headers: hdr({ From: "Priya <p@x.com>", To: "sam@y.com", Subject: "Contract", Date: "Mon, 1 Sep 2026 09:00:00 +0000", "Message-ID": "<m0@x>" }), mimeType: "text/plain", body: { data: b64("Can you sign by Friday?") } } },
    { id: "m1", labelIds: ["INBOX", "UNREAD"], payload: { headers: hdr({ From: "Priya <p@x.com>", To: "sam@y.com", Subject: "Re: Contract", Date: "Tue, 2 Sep 2026 09:00:00 +0000", "Message-ID": "<m1@x>" }), mimeType: "text/plain", body: { data: b64("Following up!\n\nOn Mon, Sep 1 Priya wrote:\n> Can you sign") } } },
  ],
};

describe("GmailClient", () => {
  it("searches threads and summarizes their latest headers", async () => {
    const { impl, calls } = stub([
      [/\/threads\?/, () => Response.json({ threads: [{ id: "t1" }] })],
      [/\/threads\/t1\?format=metadata/, () => Response.json(THREAD)],
    ]);
    const client = new GmailClient(tokens(["a"]).provider, impl);
    const list = await client.searchThreads("is:unread", 5);
    expect(list).toEqual([{ id: "t1", from: "Priya", subject: "Re: Contract", date: "Tue, 2 Sep 2026 09:00:00 +0000", unread: true, messageCount: 2 }]);
    expect(calls[0]?.path).toContain("q=is%3Aunread");
    expect(calls[0]?.path).toContain("maxResults=5");
  });

  it("reads a thread as clean text", async () => {
    const { impl } = stub([[/\/threads\/t1\?format=full/, () => Response.json(THREAD)]]);
    const t = await new GmailClient(tokens(["a"]).provider, impl).getThread("t1");
    expect(t.subject).toBe("Contract");
    expect(t.messages.map((m) => m.text)).toEqual(["Can you sign by Friday?", "Following up!"]);
    expect(t.messages[1]).toMatchObject({ from: "Priya <p@x.com>", messageId: "<m1@x>" });
  });

  it("archives and unarchives via the INBOX label", async () => {
    const { impl, calls } = stub([[/\/modify$/, () => Response.json({})]]);
    const client = new GmailClient(tokens(["a"]).provider, impl);
    await client.archive(["t1", "t2"]);
    await client.unarchive(["t1"]);
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ["/gmail/v1/users/me/threads/t1/modify", { removeLabelIds: ["INBOX"] }],
      ["/gmail/v1/users/me/threads/t2/modify", { removeLabelIds: ["INBOX"] }],
      ["/gmail/v1/users/me/threads/t1/modify", { addLabelIds: ["INBOX"] }],
    ]);
  });

  it("creates a threaded reply draft addressed to the other person", async () => {
    const { impl, calls } = stub([[/\/drafts$/, () => Response.json({ id: "d1", message: { id: "dm1", threadId: "t1" } })]]);
    const client = new GmailClient(tokens(["a"]).provider, impl);
    const thread = { id: "t1", subject: "Contract", messages: [{ from: "Priya <p@x.com>", to: "sam@y.com", date: "", text: "hi", messageId: "<m1@x>" }] };
    const out = await client.createReplyDraft(thread, "sam@y.com", "Thursday works.");
    expect(out).toEqual({ draftId: "d1", to: "Priya <p@x.com>", subject: "Re: Contract" });
    const body = calls[0]?.body as { message: { threadId: string; raw: string } };
    expect(body.message.threadId).toBe("t1");
    expect(atob(body.message.raw.replace(/-/g, "+").replace(/_/g, "/"))).toContain("In-Reply-To: <m1@x>");
  });

  it("refreshes the token once on a 401 and retries", async () => {
    const seen: string[] = [];
    const impl = (async (_input: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(auth);
      return auth === "Bearer old" ? new Response("expired", { status: 401 }) : Response.json({ threads: [] });
    }) as unknown as typeof fetch;
    const t = tokens(["old", "new"]);
    expect(await new GmailClient(t.provider, impl).searchThreads("x", 1)).toEqual([]);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
    expect(t.invalidations()).toBe(1);
  });

  it("caps archive batches", async () => {
    const { impl } = stub([[/\/modify$/, () => Response.json({})]]);
    await expect(new GmailClient(tokens(["a"]).provider, impl).archive(Array.from({ length: 26 }, (_, i) => `t${i}`))).rejects.toThrow(/at most 25/);
  });
});

describe("GmailClient with the platform fetch", () => {
  it("never calls fetch as a method (workerd throws 'Illegal invocation' for a foreign this)", async () => {
    const nativeLike = function (this: unknown, _input: string) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
      return Promise.resolve(Response.json({ threads: [] }));
    } as unknown as typeof fetch;
    await expect(new GmailClient({ get: async () => "a", invalidate: () => {} }, nativeLike).searchThreads("x", 1)).resolves.toEqual([]);
  });
});
