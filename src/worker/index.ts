import { Hono } from "hono";
import type { Env } from "./env";

export { OnboardingAgent } from "./agent/onboarding-agent";
export { BudgetDO } from "./limits/budget";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ ok: true }));

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
