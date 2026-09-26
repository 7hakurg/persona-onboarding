import { CONFIG } from "../config";
import { sign, verify } from "../security/hmac";

const ID_PATTERN = /^[a-f0-9]{32}$/;
const CONTEXT = "session";

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A session token is `<id>.<hmac(id)>`. The id names the Durable Object; the signature
 * means ids can't be minted client-side to dodge per-session limits.
 */
export async function issueSessionToken(secret: string): Promise<{ id: string; token: string }> {
  const id = newId();
  return { id, token: `${id}.${await sign(secret, CONTEXT, id)}` };
}

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CONFIG.cookie.name) return rest.join("=");
  }
  return null;
}

/** Returns the verified session id, or null for a missing, malformed, or forged cookie. */
export async function readSessionId(request: Request, secret: string): Promise<string | null> {
  const value = cookieValue(request);
  if (!value) return null;
  const [id, sig, extra] = value.split(".");
  if (!id || !sig || extra !== undefined || !ID_PATTERN.test(id)) return null;
  return (await verify(secret, CONTEXT, id, sig)) ? id : null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const attrs = [`${CONFIG.cookie.name}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${CONFIG.cookie.maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}
