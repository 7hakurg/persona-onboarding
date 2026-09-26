# Persona Onboarding — Design Spec

**Date:** 2026-09-26
**Status:** Draft for review

## 1. Goal

A hosted, publicly reachable demo of a Persona-style onboarding. A new user meets their
assistant in an iMessage-style chat inside a phone simulator. The assistant:

1. gets **named by the user** (text only),
2. **calls the user** (live voice in the simulator) to learn the **user's name**, get **Gmail
   connected**, and find **something the user wants help with**,
3. shows real value (an insight from the user's inbox tied to their goal), and
4. lets the user **graduate** into the main experience whenever they want.

Interviewers will stress-test it. The primary success criterion is: **no input sequence
dead-ends the user or corrupts state.** The secondary criterion is that it feels like
talking to an assistant, not filling a form.

### Non-goals

- Real iMessage delivery (no official API; mentioned in the write-up only).
- Multi-language support.
- User accounts / login. A session is identified by a cookie.
- Persisting Gmail credentials or acting on the inbox beyond a read-only snapshot.

## 2. Requirements

### Functional

| ID | Requirement |
|----|-------------|
| F1 | Collect `agentName` via text. The assistant never *asks* for it on a call; if the user explicitly asks to rename the agent during a call, it is accepted. |
| F2 | Attempt a voice call to collect `userName`, Gmail connection, and `helpGoal`. |
| F3 | Every slot can also be collected over text (adaptive fallback when the call is declined, dropped, or impossible). |
| F4 | Users may volunteer several slots in one utterance; all are captured. |
| F5 | Users may graduate early at any point. If Gmail is not connected, the assistant nudges exactly once, then complies. Missing slots get defaults (`agentName` → "Persona", `userName` → unknown) and are recoverable later. |
| F6 | Hangup, decline, no answer, mic denied, network drop, tab close, and max duration are all detected and followed by a context-aware recovery message in chat. |
| F7 | A call can be (re)started at any time and only covers what is still missing. |
| F8 | Anything the user said on a call before it dropped is not lost (post-call extraction). |
| F9 | Real Google OAuth. After connecting, show an inbox insight related to `helpGoal`. |
| F10 | Refreshing the page or reopening the tab resumes the same session exactly. |
| F11 | A "Start over" control resets the session. |
| F12 | A "Behind the scenes" panel (desktop) shows live session state and event log, for reviewers. |

### Non-functional

| ID | Requirement |
|----|-------------|
| N1 | Voice latency comparable to a phone call (speech-to-speech model, barge-in supported). |
| N2 | Public URL on Cloudflare Workers. |
| N3 | Abuse and spend protection: per-session and per-IP rate limits, a global daily voice-minute budget, max call duration, input size caps. |
| N4 | No secrets in the client or repo. OpenAI key used client-side only as a short-lived ephemeral secret. |
| N5 | 80%+ unit test coverage on server logic; E2E coverage of critical flows with a fake LLM. |

## 3. Architecture

```
Browser (React SPA, phone simulator)
  │  WebSocket (Cloudflare Agents SDK: state sync + RPC)
  ▼
Cloudflare Worker (Hono router)
  ├─ /agents/onboarding/:sid  → OnboardingAgent (Durable Object, 1 per session)  ◄── source of truth
  ├─ /auth/google/start|callback → Google OAuth (tokens never persisted)
  └─ static assets (SPA)

OnboardingAgent ── OpenAI Responses API (chat conductor, gpt-5.4-mini)
                 ── OpenAI /v1/realtime/client_secrets (ephemeral key for the call)
                 ── Gmail API (one-shot inbox snapshot inside the OAuth callback)

Browser ══ WebRTC ══ OpenAI Realtime (gpt-realtime-2.1)
   voice tool calls arrive on the data channel → forwarded to OnboardingAgent via RPC
   → validated + applied → result returned → sent back as function_call_output
```

### Why this shape

- **One authority.** Both channels (chat, voice) mutate state only through the Durable
  Object. The voice model proposes; the server validates and decides. Tool results carry
  the updated "what's still missing" so the voice model stays in sync.
- **Browser-side WebRTC** gives the best voice quality and barge-in with the least moving
  parts. The alternative (server sideband WebSocket) was rejected for this phase due to
  complexity; it is used in the Phase 2 real-phone adapter where it is required.
- **Agents SDK** provides DO-backed state that syncs to every connected tab, typed
  callable RPC, WebSocket hibernation, and scheduling (alarms) — the pieces we would
  otherwise hand-roll.

### Channel adapter boundary

The conductor never talks to a transport directly. A `CallChannel` interface
(`start(session) → handle`, events: `connected`, `toolCall`, `transcript`, `ended(reason)`)
has one Phase 1 implementation (`BrowserRealtimeChannel`) and one Phase 2 implementation
(`TwilioSipChannel`). Chat is its own channel with the same tool set.

## 4. Session State

```ts
type Channel = "text" | "voice";

type Slot<T> =
  | { status: "empty" }
  | { status: "pending_confirmation"; value: T; source: Channel }
  | { status: "filled"; value: T; source: Channel; at: number }
  | { status: "defaulted"; value: T }
  | { status: "parked"; attempts: number };          // asked twice, moved on

type GmailState =
  | { status: "not_connected" }
  | { status: "link_sent"; at: number }
  | { status: "declined"; at: number }
  | { status: "connected_limited"; email: string }   // identity only, no gmail scope
  | { status: "connected"; email: string; snapshot: InboxSnapshot; insight: string }
  | { status: "error"; reason: string };

type CallEndReason =
  | "completed" | "user_hangup" | "declined" | "no_answer" | "mic_denied"
  | "connection_failed" | "dropped" | "max_duration" | "page_closed" | "budget_exhausted";

type CallState =
  | { status: "idle" }
  | { status: "ringing"; callId: string; since: number }
  | { status: "active"; callId: string; since: number; lastHeartbeat: number }
  | { status: "ended"; callId: string; reason: CallEndReason; at: number };

type Phase = "intro" | "naming" | "calling" | "collecting_text" | "wrapup" | "graduated";

interface SessionState {
  version: 1;
  phase: Phase;
  slots: { agentName: Slot<string>; userName: Slot<string>; helpGoal: Slot<string> };
  gmail: GmailState;
  call: CallState;
  callAttempts: number;
  messages: ChatMessage[];          // capped at 200; older ones summarized
  events: SessionEvent[];           // capped at 100, shown in Behind-the-scenes panel
  nudges: { gmailBeforeGraduate: boolean; idle: number };
  createdAt: number;
}
```

`ChatMessage` kinds: `text` (user/assistant), `call_card` (missed/ended call with
duration), `gmail_card` (connect button / connected summary), `insight_card`,
`system_notice`. All state transitions are **pure functions** in `state/` returning new
objects; the DO only persists and broadcasts the result.

## 5. The Conductor (shared brain)

One policy drives both channels.

- **Prompt assembly (`prompts.ts`)** — rebuilt every turn from state: persona and tone,
  what's known, what's missing, current phase, the channel's rules, and the *single next
  best step*. Persona voice: warm, brief, a little playful, never lists questions.
- **Next-step policy (`policy.ts`, pure)** — decides the next goal: name the agent →
  offer the call → (on call) user name → help goal → gmail → wrap up. Order adapts: if the
  user leads with their goal, the goal is acknowledged and acted on first.
- **Tools (`tools.ts`, zod schemas, shared)**

  | Tool | Text | Voice | Notes |
  |------|------|-------|-------|
  | `set_agent_name(name)` | yes | only on explicit rename request | validated |
  | `set_user_name(name, confirmed)` | yes | yes | may land in `pending_confirmation` |
  | `set_help_goal(goal)` | yes | yes | 3–500 chars, summarized |
  | `send_gmail_link()` | yes | yes | posts `gmail_card` to chat |
  | `check_gmail_status()` | yes | yes | lets voice react when the user finishes OAuth |
  | `start_call()` | yes | — | rings the simulator |
  | `end_call(reason)` | — | yes | only after wrap-up or on user request |
  | `graduate()` | yes | yes | enforces the one-time gmail nudge |

- **Guardrails in code, not prompt:** channel/tool permissions, slot validation, max two
  asks per slot before parking, one gmail nudge before graduating, tool-loop cap of 4
  iterations per turn, all tool args validated with zod; invalid calls return a
  structured error the model can recover from.
- **Validators (`slots.ts`):** names are trimmed, stripped of lead-ins ("my name is",
  "call me"), 1–40 chars, letters/spaces/`'`/`-`/`.`; digits-only, URLs, or empty are
  rejected. Joke or unusual names are accepted but asked to confirm once. The agent name
  may be any 1–30 char string without URLs.
- **Turn serialization:** chat turns are queued per session; rapid-fire messages sent
  while a turn is running are coalesced into the next turn.
- **Prompt injection:** user text is always in the user role; tool permissions and
  validation are enforced server-side regardless of model output.
- **Proactivity:** greeting on first connect; after-call follow-up; one idle nudge after
  2 minutes of silence mid-onboarding (DO alarm), never more.

## 6. Voice Call Lifecycle

1. `start_call` (from conductor or a "Call me" chip) → checks budget and per-session call
   limit (5) → state `ringing` → simulator shows incoming call (30s timeout → `no_answer`).
2. **Accept** → client calls `beginCall()` RPC → DO mints an ephemeral client secret with
   session config: instructions built from current state, voice tools, `gpt-4o-mini-transcribe`
   input transcription, server VAD, voice `marin`. → client opens WebRTC with the secret.
3. **During the call:** the client forwards `function_call` events to `voiceToolCall()` and
   returns the result; final transcripts (both sides) go to `voiceTranscript()` and appear
   as live captions; a heartbeat every 5s goes to `callHeartbeat()`.
4. **Ending:** any end path calls `endCall(reason)`. Client-detectable reasons: decline,
   hangup button, mic denied, WebRTC `failed`, `pagehide` (sent via `navigator.sendBeacon`
   to `/api/call-ended`). Server-detected: heartbeat stale >20s → `dropped`; duration >5 min
   → `max_duration` (client is told to hang up; secret expiry is the hard stop).
5. **After the call:** a structured-output **extraction pass** runs over the call
   transcript to capture any slot the user stated but the model didn't save (F8). Then the
   conductor posts a follow-up based on reason and what's missing, e.g. *"Looks like we
   got cut off — I caught your name, Sam. Want me to call back, or finish the last bit
   here?"* with chips `[Call me back] [Text is fine] [Skip to the app]`.

Decline, no-answer, and mic-denied switch to `collecting_text` without guilt-tripping.
A second failed call attempt stops offering calls proactively (user can still ask).

## 7. Gmail

- The `gmail_card` Connect button opens `/auth/google/start` in a popup (falls back to a
  full redirect if popups are blocked). The call continues; the simulator shows an
  iOS-style green "in call" pill.
- `start`: requires the session cookie; `state` = base64url(`sid.nonce.exp`) + HMAC-SHA256
  (secret `OAUTH_STATE_SECRET`), 10 min expiry, nonce stored in the DO for single use.
  Scopes: `openid email profile https://www.googleapis.com/auth/gmail.readonly`,
  `access_type=online`, `include_granted_scopes=true`.
- `callback`: verify state and nonce → exchange code → read granted scopes →
  userinfo email → if Gmail scope granted, list up to 50 unread messages from the last 7
  days (metadata: From, Subject) → compute snapshot (unread count, top 3 senders, a few
  subjects) → LLM writes one insight tied to `helpGoal` (or a generic one) → store
  snapshot + insight only. **Access token is dropped when the request ends; nothing
  about credentials is persisted.** Page `postMessage`s the opener and closes.
- Outcomes: `connected`, `connected_limited` (Gmail scope unchecked), `declined` (user
  cancels consent), `error`. Each has a conductor response; declined gets one later retry
  offer, never repeated nagging.
- **Setup:** reuse the existing web OAuth client (project `klio-508117`). The redirect URI
  `https://<worker-host>/auth/google/callback` must be added in Google Cloud Console, and
  the Gmail API enabled. If the consent screen is in Testing mode, testers must be
  added as test users (restricted scope). Consent screen branding will read "Klio".

## 8. UI

- **Layout:** desktop shows a centered phone frame plus a collapsible "Behind the scenes"
  panel (slots, phase, call state, event log). Mobile shows the phone UI full-screen.
- **Messages screen:** iMessage look; header with avatar and the agent's current name
  (updates live when named); typing indicator; streaming assistant replies;
  contextual quick-reply chips; inline cards (missed call, call summary, Gmail connect,
  inbox insight).
- **Call screens:** incoming (Accept/Decline, ringtone), active (timer, audio-level
  waveform, live captions, Mute, Speaker, Messages, End), in-call pill when minimized.
- **Home screen (graduated):** greeting by name, "What I know about you" (editable
  slots), inbox insight, and a chat box to keep talking to the agent.
- Accessibility: keyboard reachable controls, ARIA labels on call controls, captions
  always available, respects reduced motion.

## 9. Security, Limits, Cost

- Session cookie `sid`: 128-bit random, `HttpOnly; Secure; SameSite=Lax`. The agent
  WebSocket route verifies the cookie matches the requested session name
  (`onBeforeConnect`), so sessions cannot be joined by guessing names.
- Limits: 40 chat messages / 10 min per session; 5 calls per session; 5 min per call;
  message length ≤ 1,000 chars; per-IP new-session limit via Workers Rate Limiting
  binding; global daily voice-minute budget (configurable, default 300) tracked in a
  singleton `BudgetDO`. When exhausted, calls are replaced by a friendly text-only path
  (`budget_exhausted`).
- Secrets as Worker secrets: `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `OAUTH_STATE_SECRET`. Validated at startup of each request path; missing Google config
  disables the Gmail card with a clear message instead of failing.
- CSP restricting scripts to self; connect-src allows `api.openai.com`.
- Server logs: structured JSON with session id and event type; never message content
  or tokens.

## 10. Configuration

All tunables in one `config.ts` (model names, voice, limits, timeouts, budget), overridable
by Worker vars. Models: chat `gpt-5.4-mini`, realtime `gpt-realtime-2.1`, transcription
`gpt-4o-mini-transcribe`.

## 11. Testing

- **Unit (Vitest + `@cloudflare/vitest-pool-workers`):** state reducers, policy
  next-step, validators, tool permission matrix, graduation rules, OAuth state signing
  and verification, rate limiter, budget, prompt assembly snapshots.
- **Integration:** `OnboardingAgent` with a scripted `LlmClient` fake — chat turns, tool
  loops, coalescing, call lifecycle including heartbeat-timeout drop, extraction pass,
  resume after reconnect.
- **E2E (Playwright, fake LLM + fake realtime channel):** happy path; decline call → text
  completion; hangup mid-call → recovery; early graduation with gmail nudge; refresh
  mid-flow resumes; multi-slot utterance.
- **Chaos script:** a list of adversarial user scripts (joke names, refusals, injection
  attempts, gibberish, rapid-fire messages, repeated call spam) run against the fake and,
  manually, against the live model.
- Coverage target 80%+ on `src/worker`.

## 12. Phases

1. **Phase 1 — core demo (this plan):** everything above, deployed to
   `*.workers.dev`.
2. **Phase 2 — real phone add-on:** "Call my real phone instead" option. Twilio number →
   OpenAI Realtime SIP; `realtime.call.incoming` webhook → Worker accepts with
   state-derived instructions; the DO holds a sideband WebSocket to execute tools.
   Requires a Twilio account; trial accounts can only call verified numbers. Built behind
   the same `CallChannel` interface; not started until Phase 1 is live and stable.

## 13. Risks

| Risk | Mitigation |
|------|-----------|
| Gmail restricted scope blocks testers | Identity-only `connected_limited` path still completes onboarding; document adding test users. |
| Voice model skips tool calls | Post-call extraction pass; tool results restate what's missing. |
| Spend from stress testing | Budget DO, per-session/IP limits, max call length, OpenAI project budget limit. |
| Browser mic / autoplay restrictions | Accepting the call is a user gesture that unlocks audio; mic-denied path falls back to text. |
| OpenAI outage | Call start fails fast → `connection_failed` → text path. |
