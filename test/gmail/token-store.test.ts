import { describe, expect, it } from "vitest";
import { GmailAuthRevokedError, GmailTokenStore, type KvStore } from "../../src/worker/gmail/token-store";
import { encryptString } from "../../src/worker/security/crypto-box";

const KEY = "e".repeat(32);
const cfg = { clientId: "c", clientSecret: "s", encryptionKey: KEY };

function memory(): KvStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k) as never, put: async (k, v) => void data.set(k, v), delete: async (k) => data.delete(k) };
}

function tokenEndpoint(responses: Response[]) {
  let calls = 0;
  const impl = (async () => { calls += 1; return responses.shift() ?? Response.json({ access_token: "ya29.more", expires_in: 3600 }); }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

describe("GmailTokenStore", () => {
  it("serves the fresh access token until it expires, then refreshes", async () => {
    let now = 1_000_000;
    const kv = memory();
    const google = tokenEndpoint([Response.json({ access_token: "ya29.refreshed", expires_in: 3600 })]);
    const store = new GmailTokenStore(kv, cfg, google.impl, () => now);
    await store.save(await encryptString(KEY, "1//refresh"), { accessToken: "ya29.first", expiresInSeconds: 3600 });
    expect(await store.provider().get()).toBe("ya29.first");
    now += 3600_000;
    expect(await store.provider().get()).toBe("ya29.refreshed");
    expect(google.calls()).toBe(1);
  });

  it("stores only the encrypted refresh token", async () => {
    const kv = memory();
    const store = new GmailTokenStore(kv, cfg, tokenEndpoint([]).impl);
    await store.save(await encryptString(KEY, "1//refresh"), { accessToken: "ya29.first", expiresInSeconds: 3600 });
    const persisted = JSON.stringify([...kv.data.values()]);
    expect(persisted).not.toContain("1//refresh");
    expect(persisted).not.toContain("ya29");
  });

  it("refreshes after invalidate()", async () => {
    const google = tokenEndpoint([Response.json({ access_token: "ya29.second", expires_in: 3600 })]);
    const store = new GmailTokenStore(memory(), cfg, google.impl);
    await store.save(await encryptString(KEY, "1//refresh"), { accessToken: "ya29.first", expiresInSeconds: 3600 });
    const p = store.provider();
    p.invalidate();
    expect(await p.get()).toBe("ya29.second");
  });

  it("raises GmailAuthRevokedError when Google rejects the refresh token", async () => {
    let now = 0;
    const google = tokenEndpoint([Response.json({ error: "invalid_grant" }, { status: 400 })]);
    const store = new GmailTokenStore(memory(), cfg, google.impl, () => now);
    await store.save(await encryptString(KEY, "1//refresh"), { accessToken: "a", expiresInSeconds: 1 });
    now = 10_000;
    await expect(store.provider().get()).rejects.toBeInstanceOf(GmailAuthRevokedError);
  });

  it("clear() returns the refresh token for revocation and forgets everything", async () => {
    const kv = memory();
    const store = new GmailTokenStore(kv, cfg, tokenEndpoint([]).impl);
    await store.save(await encryptString(KEY, "1//refresh"), { accessToken: "a", expiresInSeconds: 3600 });
    expect(await store.clear()).toBe("1//refresh");
    expect(kv.data.size).toBe(0);
    await expect(store.provider().get()).rejects.toBeInstanceOf(GmailAuthRevokedError);
  });
});
