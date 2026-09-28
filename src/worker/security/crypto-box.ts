import { fromB64Url, toB64Url } from "./hmac";

const VERSION = "v1";
const INFO = "persona-token-box";
const MIN_SECRET_CHARS = 32;
const encoder = new TextEncoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (secret.length < MIN_SECRET_CHARS) throw new Error(`Encryption secret must be at least ${MIN_SECRET_CHARS} characters`);
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(INFO), info: encoder.encode(VERSION) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** AES-256-GCM with a random 96-bit IV. Output: `v1.<iv>.<ciphertext>` (base64url). */
export async function encryptString(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(secret), encoder.encode(plaintext));
  return `${VERSION}.${toB64Url(iv)}.${toB64Url(new Uint8Array(cipher))}`;
}

/** Returns null for anything that doesn't authenticate (wrong key, tampering, junk). */
export async function decryptString(secret: string, box: string): Promise<string | null> {
  const [version, ivText, cipherText, extra] = box.split(".");
  if (version !== VERSION || !ivText || !cipherText || extra !== undefined) return null;
  const iv = fromB64Url(ivText);
  const cipher = fromB64Url(cipherText);
  if (!iv || !cipher || iv.length !== 12) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await deriveKey(secret), cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
