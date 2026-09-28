import { describe, expect, it } from "vitest";
import { buildReplyRaw, extractBodyText, stripQuoted } from "../../src/worker/gmail/mime";

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("extractBodyText", () => {
  it("prefers text/plain inside multipart", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>Hello <b>HTML</b></p>") } },
        { mimeType: "text/plain", body: { data: b64("Hello plain ✓") } },
      ],
    };
    expect(extractBodyText(payload)).toBe("Hello plain ✓");
  });
  it("falls back to stripped HTML, dropping scripts and styles", () => {
    const html = "<style>.x{}</style><script>alert(1)</script><p>Hi&nbsp;Sam,</p><p>See you &amp; bye</p>";
    expect(extractBodyText({ mimeType: "text/html", body: { data: b64(html) } })).toBe("Hi Sam,\nSee you & bye");
  });
  it("returns empty for missing bodies", () => {
    expect(extractBodyText({ mimeType: "multipart/mixed", parts: [{ mimeType: "application/pdf", body: {} }] })).toBe("");
  });
});

describe("stripQuoted", () => {
  it("removes quoted replies and the 'On … wrote:' tail", () => {
    const text = "Thursday works!\n\nOn Mon, Sep 1, 2026 at 9:00 AM Priya <p@x.com> wrote:\n> Can we meet?\n> Thanks";
    expect(stripQuoted(text)).toBe("Thursday works!");
  });
});

describe("buildReplyRaw", () => {
  it("builds a threaded RFC 2822 reply with encoded headers", () => {
    const raw = buildReplyRaw({ to: "Priya <p@x.com>", subject: "Contract", body: "Thursday works.\nThanks!", inReplyTo: "<m1@x>", references: "<m0@x> <m1@x>" });
    const decoded = decodeURIComponent(escape(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))));
    expect(decoded).toContain("To: Priya <p@x.com>\r\n");
    expect(decoded).toContain("Subject: Re: Contract\r\n");
    expect(decoded).toContain("In-Reply-To: <m1@x>\r\n");
    expect(decoded).toContain("References: <m0@x> <m1@x>\r\n");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded.endsWith("Thursday works.\r\nThanks!")).toBe(true);
  });
  it("does not double the Re: prefix and strips header injection", () => {
    const raw = buildReplyRaw({ to: "a@b.co\r\nBcc: evil@x.com", subject: "Re: Hi\r\nBcc: evil@x.com", body: "x", inReplyTo: null, references: null });
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).not.toMatch(/^Bcc:/m);
    expect(decoded).toContain("Subject: Re: Hi Bcc: evil@x.com\r\n");
  });
});
