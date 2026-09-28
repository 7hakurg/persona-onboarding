declare global {
  namespace Cloudflare {
    interface Env {
      OAUTH_STATE_SECRET: string;
      /** ≥32 chars; encrypts stored Gmail refresh tokens. */
      TOKEN_ENCRYPTION_KEY: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      /** "1" switches the LLM and Live API to deterministic fakes (tests / E2E). */
      FAKE_LLM?: string;
    }
  }
}

export type Env = Cloudflare.Env;

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(`Missing required secret: ${name}`);
    this.name = "MissingSecretError";
  }
}

export function requireSecret(env: Env, name: "OPENAI_API_KEY" | "OAUTH_STATE_SECRET" | "TOKEN_ENCRYPTION_KEY"): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") throw new MissingSecretError(name);
  return value;
}

export function googleConfig(env: Env): { clientId: string; clientSecret: string } | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}
