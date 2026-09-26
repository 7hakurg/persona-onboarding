import { fromB64Url, sign, toB64Url, verify } from "../security/hmac";

export interface OAuthStatePayload {
  sid: string;
  nonce: string;
  exp: number;
}

const CONTEXT = "oauth-state";

export async function signState(secret: string, payload: OAuthStatePayload): Promise<string> {
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await sign(secret, CONTEXT, body)}`;
}

function isPayload(value: unknown): value is OAuthStatePayload {
  const v = value as Partial<OAuthStatePayload>;
  return typeof v?.sid === "string" && typeof v.nonce === "string" && typeof v.exp === "number";
}

/** Returns the payload only if the signature is valid (constant-time) and it has not expired. */
export async function verifyState(secret: string, token: string, now: number): Promise<OAuthStatePayload | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!(await verify(secret, CONTEXT, body, sig))) return null;
  const json = fromB64Url(body);
  if (!json) return null;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(json));
    return isPayload(payload) && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
