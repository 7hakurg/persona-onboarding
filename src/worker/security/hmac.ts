const encoder = new TextEncoder();

export function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** HMAC-SHA256 over `${context}:${message}`; the context label domain-separates uses of one secret. */
export async function sign(secret: string, context: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(`${context}:${message}`));
  return toB64Url(new Uint8Array(sig));
}

/** Constant-time verification (crypto.subtle.verify). */
export async function verify(secret: string, context: string, message: string, signature: string): Promise<boolean> {
  const bytes = fromB64Url(signature);
  if (!bytes) return false;
  return crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(`${context}:${message}`));
}
