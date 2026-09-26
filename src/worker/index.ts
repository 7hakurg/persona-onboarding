import { getAgentByName, routeAgentRequest } from "agents";
import { Hono, type Context } from "hono";
import { AGENT_NAMESPACE, SELF_SESSION_NAME } from "../shared/rpc";
import type { OnboardingAgent } from "./agent/onboarding-agent";
import { googleConfig, requireSecret, type Env } from "./env";
import { registerGmailRoutes } from "./http/gmail-routes";
import { isSameOrigin, issueSessionToken, readSessionId, sessionCookie } from "./http/session-cookie";
import { errorFields, log } from "./log";

export { OnboardingAgent } from "./agent/onboarding-agent";
export { BudgetDO } from "./limits/budget";

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();
const SELF_PATH = `/agents/${AGENT_NAMESPACE}/${SELF_SESSION_NAME}`;

app.get("/healthz", (c) => c.json({ ok: true }));
registerGmailRoutes(app);

app.get("/api/config", (c) => c.json({ gmail: googleConfig(c.env) !== null }));

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

async function setNewSession(c: AppContext): Promise<void> {
  const { token } = await issueSessionToken(requireSecret(c.env, "OAUTH_STATE_SECRET"));
  c.header("Set-Cookie", sessionCookie(token, new URL(c.req.url).protocol === "https:"));
}

app.post("/api/session", async (c) => {
  if (!isSameOrigin(c.req.raw)) return c.json({ ok: false, error: "forbidden" }, 403);
  if (await readSessionId(c.req.raw, requireSecret(c.env, "OAUTH_STATE_SECRET"))) return c.json({ ok: true });
  if (!(await c.env.SESSION_LIMITER.limit({ key: clientIp(c.req.raw) })).success) return c.json({ ok: false, error: "rate_limited" }, 429);
  await setNewSession(c);
  return c.json({ ok: true });
});

app.post("/api/reset", async (c) => {
  if (!isSameOrigin(c.req.raw)) return c.json({ ok: false, error: "forbidden" }, 403);
  if (!(await c.env.SESSION_LIMITER.limit({ key: clientIp(c.req.raw) })).success) return c.json({ ok: false, error: "rate_limited" }, 429);
  const old = await readSessionId(c.req.raw, requireSecret(c.env, "OAUTH_STATE_SECRET"));
  if (old) {
    // End any live call in the abandoned session so it doesn't keep running (and billing).
    try {
      await (await agentFor(c.env, old)).endCall("page_closed");
    } catch (err) {
      log("warn", "reset_end_call_failed", errorFields(err));
    }
  }
  await setNewSession(c);
  return c.json({ ok: true });
});

async function agentFor(env: Env, id: string): Promise<DurableObjectStub<OnboardingAgent>> {
  return (await getAgentByName(env.ONBOARDING_AGENT as never, id)) as unknown as DurableObjectStub<OnboardingAgent>;
}

app.post("/api/call-ended", async (c) => {
  const id = await readSessionId(c.req.raw, requireSecret(c.env, "OAUTH_STATE_SECRET"));
  if (!id) return c.body(null, 204);
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.body(null, 403);
  await (await agentFor(c.env, id)).endCall("page_closed");
  return c.body(null, 204);
});

app.all(`/agents/${AGENT_NAMESPACE}/*`, async (c) => {
  const url = new URL(c.req.url);
  // Only the caller's own session, addressed exactly as "me": no other names, no sub-paths.
  if (url.pathname !== SELF_PATH || !isSameOrigin(c.req.raw)) return c.json({ ok: false, error: "forbidden" }, 403);
  const id = await readSessionId(c.req.raw, requireSecret(c.env, "OAUTH_STATE_SECRET"));
  if (!id) return c.json({ ok: false, error: "no_session" }, 401);
  if (!(await c.env.SOCKET_LIMITER.limit({ key: clientIp(c.req.raw) })).success) return c.json({ ok: false, error: "rate_limited" }, 429);
  url.pathname = `/agents/${AGENT_NAMESPACE}/${id}`;
  const routed = await routeAgentRequest(new Request(url, c.req.raw), c.env);
  if (!routed) {
    log("error", "agent_route_miss", {});
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  return routed;
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
