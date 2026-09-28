import { getAgentByName } from "agents";
import type { Hono } from "hono";
import type { OnboardingAgent } from "../agent/onboarding-agent";
import { CONFIG } from "../config";
import { googleConfig, requireSecret, type Env } from "../env";
import { buildAuthUrl, exchangeCode, fetchInboxSnapshot, fetchUserEmail } from "../gmail/google";
import { signState, verifyState } from "../gmail/oauth-state";
import { encryptString } from "../security/crypto-box";
import type { GmailCompletion } from "../gmail/completion";
import { errorFields, log } from "../log";
import { readSessionId } from "./session-cookie";

type PageStatus = "connected" | "limited" | "declined" | "error" | "unavailable";

const PAGE_COPY: Record<PageStatus, string> = {
  connected: "Gmail connected. You can close this window.",
  limited: "Connected — without inbox access. You can close this window.",
  declined: "No problem — nothing was connected. You can close this window.",
  error: "Something went wrong connecting Gmail. Please close this window and try again.",
  unavailable: "Gmail isn't configured for this demo. You can close this window.",
};

function resultPage(status: PageStatus, httpStatus = 200): Response {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Persona · Gmail</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f2f2f7;color:#111}p{max-width:22rem;text-align:center}</style></head>
<body><p id="persona-gmail" data-status="${status}">${PAGE_COPY[status]}</p>
<script nonce="${nonce}">(function(){var s=${JSON.stringify(status)};if(window.opener){try{window.opener.postMessage({type:"persona-gmail",status:s},location.origin)}catch(e){}window.close()}else{setTimeout(function(){location.replace("/")},1200)}})();</script></body></html>`;
  return new Response(html, {
    status: httpStatus,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function agentFor(env: Env, sid: string): Promise<DurableObjectStub<OnboardingAgent>> {
  return (await getAgentByName(env.ONBOARDING_AGENT as never, sid)) as unknown as DurableObjectStub<OnboardingAgent>;
}

function redirectUri(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/auth/google/callback`;
}

async function completion(env: Env, url: URL, nonce: string): Promise<GmailCompletion> {
  if (url.searchParams.get("error")) return { nonce, outcome: "declined" };
  const cfg = googleConfig(env);
  const code = url.searchParams.get("code");
  if (!cfg || !code) return { nonce, outcome: "error", reason: "missing_code" };
  try {
    const token = await exchangeCode({ ...cfg, code, redirectUri: redirectUri(url.href) });
    const email = await fetchUserEmail(token.accessToken);
    log("info", "gmail_grant", { canRead: token.canRead, canManage: token.canManage, hasRefreshToken: token.refreshToken !== null });
    if (!token.canRead) return { nonce, outcome: "limited", email };
    const snapshot = await fetchInboxSnapshot(token.accessToken);
    const encryptedRefreshToken = token.canManage && token.refreshToken ? await encryptString(requireSecret(env, "TOKEN_ENCRYPTION_KEY"), token.refreshToken) : null;
    const grant = { accessToken: token.accessToken, expiresInSeconds: token.expiresInSeconds, encryptedRefreshToken, canManage: token.canManage };
    return { nonce, outcome: "connected", email, snapshot, grant };
  } catch (err) {
    log("error", "gmail_exchange_failed", errorFields(err));
    return { nonce, outcome: "error", reason: "exchange_failed" };
  }
}

const PAGE_FOR: Record<GmailCompletion["outcome"], PageStatus> = { connected: "connected", limited: "limited", declined: "declined", error: "error" };

export function registerGmailRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/auth/google/start", async (c) => {
    const sid = await readSessionId(c.req.raw, requireSecret(c.env, "OAUTH_STATE_SECRET"));
    if (!sid) return resultPage("error", 401);
    const cfg = googleConfig(c.env);
    if (!cfg) return resultPage("unavailable");
    const nonce = crypto.randomUUID();
    const exp = Date.now() + CONFIG.gmail.stateTtlMs;
    await (await agentFor(c.env, sid)).beginGmail(nonce, exp);
    const state = await signState(requireSecret(c.env, "OAUTH_STATE_SECRET"), { sid, nonce, exp });
    return c.redirect(buildAuthUrl({ clientId: cfg.clientId, redirectUri: redirectUri(c.req.url), state }), 302);
  });

  app.get("/auth/google/callback", async (c) => {
    const url = new URL(c.req.url);
    const payload = await verifyState(requireSecret(c.env, "OAUTH_STATE_SECRET"), url.searchParams.get("state") ?? "", Date.now());
    if (!payload) return resultPage("error", 400);
    // The browser finishing the flow must own the session that started it; otherwise a
    // consent link minted by one session could deliver someone else's inbox to it.
    if ((await readSessionId(c.req.raw, requireSecret(c.env, "OAUTH_STATE_SECRET"))) !== payload.sid) return resultPage("error", 403);
    const agent = await agentFor(c.env, payload.sid);
    if (!(await agent.hasPendingGmailNonce(payload.nonce))) return resultPage("error", 400);
    const result = await completion(c.env, url, payload.nonce);
    const accepted = await agent.completeGmail(result);
    return accepted ? resultPage(PAGE_FOR[result.outcome]) : resultPage("error", 400);
  });
}
