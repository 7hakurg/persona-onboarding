export interface OAuthStatePayload {
  sid: string;
  nonce: string;
  exp: number;
}

const encoder = new TextEncoder();

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signState(secret: string, payload: OAuthStatePayload): Promise<string> {
  const body = toB64Url(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return `${body}.${toB64Url(sig)}`;
}

function isPayload(value: unknown): value is OAuthStatePayload {
  const v = value as Partial<OAuthStatePayload>;
  return typeof v?.sid === "string" && typeof v.nonce === "string" && typeof v.exp === "number";
}

/** Returns the payload only if the signature is valid (constant-time) and it has not expired. */
export async function verifyState(secret: string, token: string, now: number): Promise<OAuthStatePayload | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const sigBytes = fromB64Url(sig);
  if (!sigBytes) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, encoder.encode(body));
  if (!ok) return null;
  const json = fromB64Url(body);
  if (!json) return null;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(json));
    return isPayload(payload) && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
