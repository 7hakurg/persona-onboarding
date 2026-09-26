# Persona Onboarding

A Persona-style onboarding where a new user meets their assistant in an iMessage-style chat, names it, gets a **live voice call** to set things up (their name, a Gmail connection, and one thing they want help with), and can graduate into the main experience whenever they like.

**Live:** https://persona-onboarding.singhkabhishek8.workers.dev

## Try to break it

- Answer three questions in one message: *"lol ok im sam, call yourself jarvis, i'm drowning in email"*.
- Decline the call, let it ring out, or hang up mid-sentence. Anything you said before the drop is kept, and the assistant follows up over text.
- Refresh during a ring or a call; close the tab mid-call; hit **Start over**.
- Say "skip" at any point. You get exactly one Gmail nudge, then you're in.
- Give a joke name ("Batman") and the assistant confirms it once. Give garbage (`Robert'); DROP TABLE`) and it's rejected server-side.
- The **Behind the scenes** panel (desktop) shows the live state and event log.

## Architecture

```
Browser (React phone simulator)
  │ WebSocket: Cloudflare Agents SDK (state sync + RPC)
  ▼
Worker (Hono) ── /agents/onboarding-agent/me → OnboardingAgent (Durable Object, 1 per session, source of truth)
              ── /auth/google/*               → Google OAuth (tokens never stored)
OnboardingAgent ── OpenAI Responses (gpt-6-luna): chat conductor with server-validated tools
                ── POST /v1/live/sessions: creates the GPT-Live call from the browser's SDP offer
                ── wss …/live/sessions/{id}/attach: sideband that executes the same tools during the call
Browser ══ WebRTC ══ GPT-Live (gpt-live-1), delegating to gpt-6-luna
```

- **One brain, two channels.** Chat and voice share one tool registry (`src/worker/conductor/tools.ts`), one set of validators, and one prompt builder. Models propose; the server validates and decides. Permissions per channel are enforced in code: for example, the voice call never *asks* for the assistant's name.
- **Recovery.** The call state machine (`src/worker/live/call-controller.ts`) maps every end reason to a follow-up: decline, no answer, mic blocked, hang-up, network drop, tab closed, time limit, moderation, or budget. After a call, an extraction pass over the transcript recovers facts the voice model didn't save.
- **Privacy.** The Gmail access token exists only inside the OAuth callback request. The server stores only an inbox snapshot (unread count, top senders) and one insight.
- **Guardrails.** HttpOnly session cookie with a same-origin check, and the browser never learns its session id. Per-session chat rate limit, per-IP session limit, 5 calls per session, 5 minutes per call, a global daily voice-minute budget, and CSP.

## Develop

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in the values
pnpm dev                         # http://localhost:5173
pnpm test                        # unit + integration tests (Workers runtime)
pnpm test:coverage
pnpm test:e2e                    # Playwright against a fake LLM
pnpm test:e2e:live               # real GPT-Live calls with a scripted fake microphone
pnpm run deploy
```

Google OAuth needs `https://<host>/auth/google/callback` registered on the OAuth client and the Gmail API enabled. While the consent screen is in Testing mode, testers must be added as test users. Users who uncheck inbox access still finish onboarding (`connected_limited`).

Design spec: `docs/superpowers/specs/2026-09-26-persona-onboarding-design.md`. Plan: `docs/superpowers/plans/2026-09-26-persona-onboarding.md`.
