import { fromB64Url, toB64Url } from "../security/hmac";

export interface MimePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: MimePart[];
}

const MAX_BODY_CHARS = 4_000;

function decode(data: string | undefined): string {
  if (!data) return "";
  const bytes = fromB64Url(data);
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function findPart(part: MimePart, type: string): MimePart | null {
  if (part.mimeType === type && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, type);
    if (hit) return hit;
  }
  return null;
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Removes quoted history so summaries focus on the newest message. */
export function stripQuoted(text: string): string {
  const cut = text.search(/\n\s*On .{0,200}wrote:\s*\n/);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  return head
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();
}

/** Plain text of a message: text/plain preferred, HTML stripped otherwise, quotes removed, capped. */
export function extractBodyText(payload: MimePart): string {
  const plain = findPart(payload, "text/plain");
  const text = plain ? decode(plain.body?.data) : htmlToText(decode(findPart(payload, "text/html")?.body?.data));
  return stripQuoted(text.replace(/\r\n/g, "\n")).slice(0, MAX_BODY_CHARS);
}

function headerValue(value: string): string {
  // Collapse CR/LF so user- or model-supplied text can never inject extra headers.
  return value.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function encodeHeader(value: string): string {
  const clean = headerValue(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(clean)))}?=`;
}

export interface ReplyDraft {
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string | null;
}

/** RFC 2822 message, base64url-encoded for the Gmail API `raw` field. */
export function buildReplyRaw(d: ReplyDraft): string {
  const subject = /^re:/i.test(headerValue(d.subject)) ? d.subject : `Re: ${d.subject}`;
  const headers = [
    `To: ${headerValue(d.to)}`,
    `Subject: ${encodeHeader(subject)}`,
    ...(d.inReplyTo ? [`In-Reply-To: ${headerValue(d.inReplyTo)}`] : []),
    ...(d.references ? [`References: ${headerValue(d.references)}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  const message = `${headers.join("\r\n")}\r\n\r\n${d.body.replace(/\r?\n/g, "\r\n")}`;
  return toB64Url(new TextEncoder().encode(message));
}
