import { CONFIG } from "../config";

const SID_PATTERN = /^[a-f0-9]{32}$/;

export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readSessionId(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CONFIG.cookie.name) {
      const value = rest.join("=");
      return SID_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookie(sid: string, secure: boolean): string {
  const attrs = [`${CONFIG.cookie.name}=${sid}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${CONFIG.cookie.maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}
