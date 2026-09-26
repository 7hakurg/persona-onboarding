import { z } from "zod";
import type { InboxSnapshot } from "../../shared/types";
import { CONFIG } from "../config";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const METADATA_SAMPLE = 25;
const TIMEOUT_MS = 10_000;

export class GoogleError extends Error {
  constructor(
    readonly step: "token" | "userinfo" | "gmail",
    readonly status: number,
  ) {
    super(`Google ${step} request failed (${status})`);
    this.name = "GoogleError";
  }
}

export function buildAuthUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: CONFIG.gmail.scopes.join(" "),
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account",
    state: args.state,
  });
  return `${AUTH_URL}?${params}`;
}

const TokenResponse = z.object({ access_token: z.string().min(1), scope: z.string().default("") });

export async function exchangeCode(args: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<{ accessToken: string; hasGmailScope: boolean }> {
  const res = await (args.fetchImpl ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: args.code, client_id: args.clientId, client_secret: args.clientSecret, redirect_uri: args.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed = TokenResponse.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success) throw new GoogleError("token", res.status);
  return { accessToken: parsed.data.access_token, hasGmailScope: parsed.data.scope.split(" ").includes(GMAIL_SCOPE) };
}

async function getJson(url: string, token: string, step: GoogleError["step"], fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new GoogleError(step, res.status);
  return res.json();
}

export async function fetchUserEmail(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const parsed = z.object({ email: z.string().email() }).safeParse(await getJson(USERINFO_URL, token, "userinfo", fetchImpl));
  if (!parsed.success) throw new GoogleError("userinfo", 200);
  return parsed.data.email;
}

const MessageList = z.object({ messages: z.array(z.object({ id: z.string() })).default([]), resultSizeEstimate: z.number().default(0) });
const MessageMeta = z.object({ payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]) }).default({ headers: [] }) });

function senderName(from: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  return (named?.[1] ?? from).trim().slice(0, 60);
}

function header(meta: z.infer<typeof MessageMeta>, name: string): string {
  return meta.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function fetchInboxSnapshot(token: string, fetchImpl: typeof fetch = fetch): Promise<InboxSnapshot> {
  const q = new URLSearchParams({ q: CONFIG.gmail.unreadLookbackQuery, maxResults: String(CONFIG.gmail.maxMessages) });
  const list = MessageList.parse(await getJson(`${GMAIL_API}/messages?${q}`, token, "gmail", fetchImpl));
  const ids = list.messages.slice(0, METADATA_SAMPLE).map((m) => m.id);
  const metas = await Promise.all(
    ids.map(async (id) => {
      const url = `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`;
      return MessageMeta.parse(await getJson(url, token, "gmail", fetchImpl));
    }),
  );
  const counts = new Map<string, number>();
  for (const m of metas) {
    const name = senderName(header(m, "From"));
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const topSenders = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const sampleSubjects = metas.map((m) => header(m, "Subject").slice(0, 120)).filter(Boolean).slice(0, 3);
  return { unreadCount: Math.max(list.resultSizeEstimate, list.messages.length), topSenders, sampleSubjects };
}
