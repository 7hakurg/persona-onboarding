import { decryptString } from "../security/crypto-box";
import type { TokenProvider } from "./client";
import { GoogleError, refreshAccessToken } from "./google";

const REFRESH_KEY = "gmail-refresh-box";
const EXPIRY_SKEW_MS = 60_000;

/** Minimal persistent key-value surface (Durable Object storage in production). */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

export interface TokenStoreConfig {
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}

/** The user must reconnect Gmail (refresh token missing, revoked, or undecryptable). */
export class GmailAuthRevokedError extends Error {
  constructor(message = "Gmail access is no longer available") {
    super(message);
    this.name = "GmailAuthRevokedError";
  }
}

/**
 * Persists only the AES-GCM-encrypted refresh token. Access tokens live in memory
 * and are refreshed on expiry or after a 401.
 */
export class GmailTokenStore {
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly kv: KvStore,
    private readonly cfg: TokenStoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async save(encryptedRefreshToken: string | null, access: { accessToken: string; expiresInSeconds: number }): Promise<void> {
    if (encryptedRefreshToken) await this.kv.put(REFRESH_KEY, encryptedRefreshToken);
    this.access = { token: access.accessToken, expiresAt: this.now() + access.expiresInSeconds * 1000 };
  }

  provider(): TokenProvider {
    return {
      get: () => this.currentToken(),
      invalidate: () => {
        this.access = null;
      },
    };
  }

  /** Forgets all credentials; returns the refresh token (if any) so it can be revoked at Google. */
  async clear(): Promise<string | null> {
    const refresh = await this.decryptRefresh();
    this.access = null;
    await this.kv.delete(REFRESH_KEY);
    return refresh;
  }

  private async currentToken(): Promise<string> {
    if (this.access && this.access.expiresAt - EXPIRY_SKEW_MS > this.now()) return this.access.token;
    const refresh = await this.decryptRefresh();
    if (!refresh) throw new GmailAuthRevokedError();
    try {
      const next = await refreshAccessToken({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret, refreshToken: refresh, fetchImpl: this.fetchImpl });
      this.access = { token: next.accessToken, expiresAt: this.now() + next.expiresInSeconds * 1000 };
      return next.accessToken;
    } catch (err) {
      if (err instanceof GoogleError && (err.status === 400 || err.status === 401)) throw new GmailAuthRevokedError();
      throw err;
    }
  }

  private async decryptRefresh(): Promise<string | null> {
    const box = await this.kv.get<string>(REFRESH_KEY);
    return box ? decryptString(this.cfg.encryptionKey, box) : null;
  }
}
