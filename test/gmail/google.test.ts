import { describe, expect, it } from "vitest";
import { buildAuthUrl, exchangeCode, fetchInboxSnapshot, fetchUserEmail, GoogleError, GMAIL_COMPOSE, GMAIL_MODIFY, refreshAccessToken, revokeToken } from "../../src/worker/gmail/google";

function router(routes: Record<string, (url: URL, init?: RequestInit) => Response>) {
  const calls: string[] = [];
  const impl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    const key = Object.keys(routes).find((k) => url.href.startsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key]!(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("google", () => {
  it("builds the consent URL", () => {
    const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://x.test/auth/google/callback", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toContain(GMAIL_MODIFY);
    expect(url.searchParams.get("scope")).toContain(GMAIL_COMPOSE);
    expect(url.searchParams.get("scope")).not.toContain("gmail.send");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges a code and reports granted scopes", async () => {
    let form = "";
    const { impl } = router({
      "https://oauth2.googleapis.com/token": (_u, init) => {
        form = String(init?.body);
        return Response.json({ access_token: "ya29.secret", refresh_token: "1//r", expires_in: 3599, scope: `openid email ${GMAIL_MODIFY} ${GMAIL_COMPOSE}` });
      },
    });
    const out = await exchangeCode({ clientId: "cid", clientSecret: "cs", code: "c0de", redirectUri: "https://x.test/cb", fetchImpl: impl });
    expect(out).toEqual({ accessToken: "ya29.secret", refreshToken: "1//r", expiresInSeconds: 3599, canRead: true, canManage: true });
    expect(form).toContain("grant_type=authorization_code");
    expect(form).toContain("code=c0de");
  });

  it("throws GoogleError when the exchange fails", async () => {
    const { impl } = router({ "https://oauth2.googleapis.com/token": () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await expect(exchangeCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "r", fetchImpl: impl })).rejects.toBeInstanceOf(GoogleError);
  });

  it("reads the user's email", async () => {
    const { impl } = router({ "https://openidconnect.googleapis.com/v1/userinfo": () => Response.json({ email: "sam@example.com" }) });
    expect(await fetchUserEmail("t", impl)).toBe("sam@example.com");
  });

  it("aggregates an unread inbox snapshot", async () => {
    const senders = ["Alice Smith <alice@x.com>", "Alice Smith <alice@x.com>", "\"GitHub\" <noreply@github.com>", "bob@y.com"];
    const { impl } = router({
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?": () =>
        Response.json({ messages: senders.map((_, i) => ({ id: `m${i}` })), resultSizeEstimate: 37 }),
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/": (url) => {
        const i = Number(url.pathname.split("/").pop()!.slice(1));
        return Response.json({ payload: { headers: [{ name: "From", value: senders[i] }, { name: "Subject", value: `Subject ${i}` }] } });
      },
    });
    const snap = await fetchInboxSnapshot("t", impl);
    expect(snap.unreadCount).toBe(37);
    expect(snap.topSenders).toEqual([
      { name: "Alice Smith", count: 2 },
      { name: "GitHub", count: 1 },
      { name: "bob@y.com", count: 1 },
    ]);
    expect(snap.sampleSubjects).toEqual(["Subject 0", "Subject 1", "Subject 2"]);
  });

  it("handles an empty inbox", async () => {
    const { impl } = router({ "https://gmail.googleapis.com/gmail/v1/users/me/messages?": () => Response.json({ resultSizeEstimate: 0 }) });
    expect(await fetchInboxSnapshot("t", impl)).toEqual({ unreadCount: 0, topSenders: [], sampleSubjects: [] });
  });
});

describe("google token lifecycle", () => {
  it("reports read-only access when only gmail.readonly was granted", async () => {
    const { impl } = router({ "https://oauth2.googleapis.com/token": () => Response.json({ access_token: "a", expires_in: 10, scope: "openid https://www.googleapis.com/auth/gmail.readonly" }) });
    const out = await exchangeCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "r", fetchImpl: impl });
    expect(out).toMatchObject({ canRead: true, canManage: false, refreshToken: null });
  });
  it("refreshes an access token", async () => {
    let form = "";
    const { impl } = router({ "https://oauth2.googleapis.com/token": (_u, init) => { form = String(init?.body); return Response.json({ access_token: "ya29.new", expires_in: 3599 }); } });
    expect(await refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "1//r", fetchImpl: impl })).toEqual({ accessToken: "ya29.new", expiresInSeconds: 3599 });
    expect(form).toContain("grant_type=refresh_token");
  });
  it("signals a revoked refresh token", async () => {
    const { impl } = router({ "https://oauth2.googleapis.com/token": () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await expect(refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "1//r", fetchImpl: impl })).rejects.toMatchObject({ step: "token", status: 400 });
  });
  it("revokes a token", async () => {
    const { impl, calls } = router({ "https://oauth2.googleapis.com/revoke": () => new Response(null, { status: 200 }) });
    await revokeToken("1//r", impl);
    expect(calls).toEqual(["POST https://oauth2.googleapis.com/revoke"]);
  });
});
