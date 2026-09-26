import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { AGENT_NAMESPACE, SELF_SESSION_NAME } from "../shared/rpc";
import type { Env } from "./env";
import { isSameOrigin, newSessionId, readSessionId, sessionCookie } from "./http/session-cookie";
import { log } from "./log";

export { OnboardingAgent } from "./agent/onboarding-agent";
export { BudgetDO } from "./limits/budget";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ ok: true }));

async function withinIpLimit(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const { success } = await env.SESSION_LIMITER.limit({ key: ip });
  return success;
}

app.post("/api/session", async (c) => {
  if (!isSameOrigin(c.req.raw)) return c.json({ ok: false, error: "forbidden" }, 403);
  if (readSessionId(c.req.raw)) return c.json({ ok: true });
  if (!(await withinIpLimit(c.env, c.req.raw))) return c.json({ ok: false, error: "rate_limited" }, 429);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", sessionCookie(newSessionId(), secure));
  return c.json({ ok: true });
});

app.post("/api/reset", async (c) => {
  if (!isSameOrigin(c.req.raw)) return c.json({ ok: false, error: "forbidden" }, 403);
  if (!(await withinIpLimit(c.env, c.req.raw))) return c.json({ ok: false, error: "rate_limited" }, 429);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", sessionCookie(newSessionId(), secure));
  return c.json({ ok: true });
});

app.all(`/agents/${AGENT_NAMESPACE}/:name{.+}`, async (c) => {
  const sid = readSessionId(c.req.raw);
  if (!sid) return c.json({ ok: false, error: "no_session" }, 401);
  const [name, ...rest] = c.req.param("name").split("/");
  if (name !== SELF_SESSION_NAME || !isSameOrigin(c.req.raw)) return c.json({ ok: false, error: "forbidden" }, 403);
  const url = new URL(c.req.url);
  url.pathname = ["", "agents", AGENT_NAMESPACE, sid, ...rest].join("/");
  const routed = await routeAgentRequest(new Request(url, c.req.raw), c.env);
  if (!routed) {
    log("error", "agent_route_miss", { path: url.pathname });
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  return routed;
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
