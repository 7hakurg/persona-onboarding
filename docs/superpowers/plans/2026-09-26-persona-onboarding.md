# Persona Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hosted phone-simulator onboarding where a Persona-style assistant gets named over text, calls the user over live voice (GPT-Live) to learn their name, connect Gmail, and learn their goal, and recovers from any user behavior.

**Architecture:** One Cloudflare Worker (Hono) serves a React SPA and routes each session to an `OnboardingAgent` Durable Object (Cloudflare Agents SDK) that owns all state. Chat turns run a `gpt-6-luna` conductor with server-validated tools. Calls are GPT-Live sessions created by the DO from the browser's SDP offer; the DO holds a sideband WebSocket that executes the same tools (Responses delegation to `gpt-6-luna`).

**Tech Stack:** TypeScript 5.9, Cloudflare Workers + Durable Objects, `agents` 0.24, Hono 4, zod 4, React 19, Vite 8 + `@cloudflare/vite-plugin`, Tailwind 4, Vitest 4 + `@cloudflare/vitest-pool-workers`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-persona-onboarding-design.md`

## Global Constraints

- Models: chat `gpt-6-luna` (reasoning effort `low`); voice `gpt-live-1`, voice `marin`, Responses delegation backend `gpt-6-luna`.
- OpenAI key is server-only (Worker secret `OPENAI_API_KEY`); the browser never receives any OpenAI credential.
- All state mutations are pure functions returning new objects; the DO persists + broadcasts. Clients may never write state (`validateStateChange` rejects non-server sources).
- Limits: 40 chat messages / 10 min / session; 5 calls / session; 5 min / call; ring timeout 30s; message ≤ 1,000 chars; daily voice-minute budget default 300.
- Agent name is never *asked for* on a call; explicit rename on a call is accepted.
- Graduation: allowed any time; exactly one Gmail nudge first if Gmail isn't connected.
- Gmail tokens are never persisted; only snapshot + insight are stored.
- Files ≤ 400 lines; functions ≤ 50 lines; no hardcoded tunables outside `src/worker/config.ts`.
- Logs are structured JSON with session id + event type, never message content or tokens.

## Review Focus

1. **Duplicate/overlapping actions** — user taps "Call me" twice, or accepts a call while a previous one is finalizing → exactly one live session exists; second request is a no-op with a friendly message.
2. **Call dies before any tool call** — user says their name then the tab closes → post-call extraction captures it; follow-up message references it.
3. **Out-of-order Gmail completion** — OAuth callback arrives after the call ended, after graduation, or twice (replay) → nonce single-use; late completion still updates state and posts a card; replay rejected.
4. **Rapid-fire / huge / empty / non-text chat input** — five messages in one second, 5,000 chars, whitespace, emoji-only → coalesced into one turn; oversized rejected with a UI error; empty ignored; emoji handled by the model.
5. **Reconnect mid-flow** — refresh during ringing / active call / pending turn → state restored; a ringing call still rings (or times out); an active call whose tab died is ended as `page_closed`/`dropped` and recovery runs.

Tests pinning each of these are listed in Tasks 4, 7, 8, 9.

## Live API facts (verified by spike, 2026-09-26)

- `POST https://api.openai.com/v1/live/sessions` JSON `{ session, transport: { type: "webrtc", sdp } }` → `201 { session: { id: "live_..." }, transport: { type: "webrtc", sdp } }`.
- Sideband: `wss://api.openai.com/v1/live/sessions/{id}/attach` with `Authorization: Bearer`. Receives every event the data channel receives.
- Events used: `session.started`, `session.input_transcript.delta {delta,start_ms,end_ms}`, `session.output_transcript.delta`, `session.delegation.created {delegation:{id,target,response_id}}`, `response.event {delegation_id, event}` where `event.type === "response.output_item.done" && event.item.type === "function_call"` carries `{call_id,name,arguments}`, `session.usage.updated {usage:{seconds}}`, `session.closed {reason}` (`close_requested|expired|content|remote_hangup|connection_lost`), `error {error:{code,message,client_event_id}}`.
- Commands used: `response.item.create {item:{type:"function_call_output",call_id,output}}` then `response.create`; `session.instructions.append|thinking.append {delegation_id:null, content}` (≤500 tokens); `session.update {session:{delegation:{responses:{instructions}}}}`; `session.close`.
- Sideband socket closes (1006) shortly after `session.closed`.

---

## File Structure

```
wrangler.jsonc                 Worker, assets, DO bindings/migrations, rate limiter
vite.config.ts                 react + cloudflare + tailwind plugins
vitest.config.ts               workers pool, fake-LLM bindings
playwright.config.ts
tsconfig.json / tsconfig.app.json / tsconfig.worker.json
index.html
src/shared/types.ts            SessionState, Slot, ChatMessage, CallState, events
src/shared/rpc.ts              RPC method names + arg/return types (client↔agent)
src/worker/index.ts            Hono app: cookie, /agents rewrite, /auth, /api, assets
src/worker/config.ts           all tunables
src/worker/env.ts              Env type + requireSecret()
src/worker/log.ts              structured logger
src/worker/http/session-cookie.ts
src/worker/http/security-headers.ts
src/worker/state/initial.ts    createInitialState()
src/worker/state/reducers.ts   pure transitions
src/worker/state/selectors.ts  missingSlots(), nextGoal(), quickReplies()
src/worker/conductor/slots.ts  validators
src/worker/conductor/tools.ts  registry: defs, zod args, channel permissions, execute()
src/worker/conductor/prompts.ts chat + voice prompts
src/worker/conductor/chat-turn.ts runChatTurn()
src/worker/conductor/extraction.ts extractFromTranscript()
src/worker/conductor/followup.ts  composeFollowup()
src/worker/llm/llm-client.ts   LlmClient interface + OpenAI Responses impl
src/worker/llm/fake-llm.ts     deterministic fake for tests/E2E
src/worker/live/events.ts      zod schemas for Live events
src/worker/live/live-api.ts    createLiveSession()
src/worker/live/sideband.ts    Sideband class (fetch-upgrade WebSocket)
src/worker/live/call-controller.ts CallController: lifecycle orchestration
src/worker/live/transcript.ts  TranscriptBuffer (delta grouping)
src/worker/gmail/oauth-state.ts sign/verify
src/worker/gmail/google.ts     auth URL, code exchange, userinfo, inbox snapshot
src/worker/limits/rate-window.ts sliding window (pure)
src/worker/limits/budget.ts    BudgetDO
src/worker/agent/onboarding-agent.ts DO: RPC surface, wiring only
src/client/main.tsx, App.tsx, styles.css
src/client/session/useSession.ts
src/client/call/live-call.ts   WebRTC client
src/client/components/*        PhoneFrame, StatusBar, MessagesScreen, Bubble, cards, Composer,
                               QuickReplies, IncomingCall, ActiveCall, InCallPill, HomeScreen,
                               BehindTheScenes
test/**                        vitest (worker pool)
e2e/**                         Playwright
```

---

### Task 1: Scaffold, config, deploy skeleton

**Files:** Create `wrangler.jsonc`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `index.html`, `src/worker/index.ts`, `src/worker/env.ts`, `src/worker/config.ts`, `src/worker/log.ts`, `src/client/main.tsx`, `src/client/App.tsx`, `src/client/styles.css`, `test/smoke.test.ts`

**Interfaces — Produces:** `Env` (`OPENAI_API_KEY`, `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `OAUTH_STATE_SECRET`, `FAKE_LLM?`, `ONBOARDING_AGENT: DurableObjectNamespace`, `BUDGET: DurableObjectNamespace`, `SESSION_LIMITER: RateLimit`, `ASSETS: Fetcher`); `CONFIG` object; `log(event, fields)`.

- [ ] Step 1: Write `test/smoke.test.ts` asserting `GET /healthz` → 200 `{ok:true}` via `SELF.fetch`.
- [ ] Step 2: Run `pnpm test` → FAIL (no worker).
- [ ] Step 3: Create configs + minimal Hono app with `/healthz`; `wrangler.jsonc` with `assets.not_found_handling: "single-page-application"`, `run_worker_first: ["/agents/*","/auth/*","/api/*","/healthz"]`, DO bindings `ONBOARDING_AGENT`→`OnboardingAgent`, `BUDGET`→`BudgetDO`, migration `v1 new_sqlite_classes`, `ratelimits` binding.
- [ ] Step 4: `pnpm test` → PASS; `pnpm build` succeeds (verifies TC39 decorators compile).
- [ ] Step 5: Commit `chore: scaffold worker, vite, tests`.

### Task 2: Shared types, initial state, pure reducers & selectors

**Files:** Create `src/shared/types.ts`, `src/worker/state/{initial,reducers,selectors}.ts`; Test `test/state/*.test.ts`

**Interfaces — Produces:**
- Types from spec §4 plus `ChatMessage = {id, at, role:"user"|"assistant"|"system", kind:"text"|"call_card"|"gmail_card"|"insight_card"|"notice", text, data?}`; `SessionEvent = {at, type, detail}`.
- `createInitialState(now): SessionState`
- Reducers (all `(state, …) => SessionState`): `appendMessage`, `appendEvent`, `setSlot(state, key, slot)`, `setGmail`, `setCall`, `setPhase`, `markNudge`, `graduate(state, now)` (applies defaults), `reset`.
- Selectors: `missingSlots(state): SlotKey[]` (+`"gmail"`), `nextGoal(state): Goal` (`"name_agent"|"offer_call"|"user_name"|"help_goal"|"gmail"|"wrap_up"|"done"`), `quickReplies(state): string[]`, `canGraduateWithoutNudge(state)`, `summaryForPrompt(state): string`.

- [ ] Step 1: Tests: initial state shape; every reducer returns a new object and leaves input deep-equal to a pre-call snapshot (immutability); message cap 200 and event cap 100 drop oldest; `graduate` fills `agentName`→"Persona" default, keeps filled slots, sets phase; `nextGoal` ordering including "user leads with goal" (helpGoal filled before userName → next is user_name); `quickReplies` for each phase (ringing → none; offer_call → `["Call me","Let's just text","Skip to the app"]`; after failed call → `["Call me back","Text is fine","Skip to the app"]`; graduated → none).
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: Run → PASS. Step 5: Commit `feat: session state model`.

### Task 3: Slot validators

**Files:** `src/worker/conductor/slots.ts`; Test `test/conductor/slots.test.ts`

**Interfaces — Produces:** `validateUserName(raw): {ok:true, value, needsConfirmation:boolean} | {ok:false, reason}`; `validateAgentName(raw)` same shape; `validateHelpGoal(raw): {ok:true,value}|{ok:false,reason}`.

- [ ] Step 1: Tests (table-driven): "my name is Sam"→Sam; "call me sam"→Sam (capitalized); "Mary-Jane O'Neil"→ok; "Robert'); DROP TABLE"→reject (`invalid_characters`); "12345"→reject; "https://x.co"→reject; "" / "   "→reject; 41-char→reject; "Sir Poops-a-lot"→ok + needsConfirmation; "Batman" → ok + needsConfirmation (from a small joke-name list plus heuristic: >3 words or contains "lol|poop|butt|xxx"); agent name "Jarvis 2.0"→ok; agent name with URL→reject; 31-char agent name→reject; goal "email"→ok; goal "a"→reject (`too_short`); goal 600 chars→truncated to 500 with ok.
- [ ] Steps 2–5: fail → implement → pass → commit `feat: slot validators`.

### Task 4: Tool registry, permissions, execution

**Files:** `src/worker/conductor/tools.ts`; Test `test/conductor/tools.test.ts`

**Interfaces — Consumes:** reducers, validators. **Produces:**
- `type ToolName = "set_agent_name"|"set_user_name"|"set_help_goal"|"send_gmail_link"|"check_gmail_status"|"start_call"|"end_call"|"graduate"`
- `toolDefinitions(channel): ResponsesFunctionTool[]` (JSON schema, `strict:true`)
- `executeTool(state, {name, argsJson, channel, now}): ToolOutcome` where `ToolOutcome = {state, result: ToolResult, effects: Effect[]}`; `ToolResult = {ok:boolean, error?:string, saved?:Record<string,string>, needsConfirmation?:boolean, stillMissing: string[], nextStep: string}`; `Effect = {type:"ring"}|{type:"post_gmail_card"}|{type:"end_call", reason:"completed"}|{type:"graduated"}`.

- [ ] Step 1: Tests: permission matrix (`start_call` absent from voice defs; `end_call` absent from text defs; executing a non-permitted tool returns `{ok:false,error:"not_allowed_on_channel"}` without state change); malformed JSON args → `invalid_arguments`; `set_user_name` with joke name → `pending_confirmation` + `needsConfirmation:true`, then `set_user_name(name, confirmed:true)` → filled; third invalid attempt on a slot → slot `parked`; `graduate` with Gmail not connected and nudge not yet given → `{ok:false,error:"nudge_first"}` and nudge marked; second `graduate` → ok + `graduated` effect; `start_call` while call `ringing|active` → `{ok:false,error:"call_in_progress"}` (Review Focus 1); `start_call` after 5 calls → `call_limit`; `send_gmail_link` when already connected → ok with no duplicate card effect.
- [ ] Steps 2–5 → commit `feat: conductor tool registry`.

### Task 5: LLM client + fake + prompts

**Files:** `src/worker/llm/{llm-client,fake-llm}.ts`, `src/worker/conductor/prompts.ts`; Tests `test/llm/llm-client.test.ts`, `test/conductor/prompts.test.ts`

**Interfaces — Produces:**
- `interface LlmClient { respond(req: {instructions:string; input: ResponsesInputItem[]; tools?: ResponsesFunctionTool[]; json?: {name:string; schema:object}}): Promise<{outputText:string; calls: {callId:string; name:string; argsJson:string}[]; raw: unknown}> }`
- `createOpenAiClient(apiKey, model, fetchImpl=fetch): LlmClient` → `POST /v1/responses` with `reasoning:{effort:"low"}`, `store:false`, 20s timeout via `AbortSignal.timeout`, one retry on 429/5xx.
- `createFakeLlm(script?)`: deterministic rules (regex name/goal extraction → tool calls; otherwise a canned reply keyed by `nextGoal`).
- `chatInstructions(state)`, `liveInstructions(state)`, `voiceBackendInstructions(state)`, `followupInstructions(state, reason)`, `insightInstructions(helpGoal)`.

- [ ] Step 1: Tests: OpenAI client builds correct body and parses `function_call` + `output_text` from a stubbed fetch; retries once on 503 then throws `LlmError`; timeout surfaces `LlmError("timeout")`; prompt snapshot tests contain known/missing facts and never contain the word "form"; voice prompts never instruct asking for the agent name; injection text in user messages never appears inside instructions.
- [ ] Steps 2–5 → commit `feat: llm client and prompts`.

### Task 6: Chat turn runner

**Files:** `src/worker/conductor/chat-turn.ts`; Test `test/conductor/chat-turn.test.ts`

**Interfaces — Produces:** `runChatTurn(state, llm, now): Promise<{state, effects: Effect[]}>` — builds input from the last 30 text messages, loops tool calls (max 4 iterations) through `executeTool(..., channel:"text")`, appends the final assistant message; on `LlmError` appends a friendly fallback ("I blanked for a sec — say that again?") and logs.

- [ ] Step 1: Tests with fake LLM: multi-slot utterance fills three slots in one turn (spec F4); tool loop capped at 4; LLM error → fallback message, state otherwise unchanged; empty assistant text after tools → uses selector-driven default line.
- [ ] Steps 2–5 → commit `feat: chat turn runner`.

### Task 7: OnboardingAgent (chat path) + Worker routing + cookies + rate limits

**Files:** `src/worker/agent/onboarding-agent.ts`, `src/worker/http/{session-cookie,security-headers}.ts`, `src/worker/limits/rate-window.ts`, modify `src/worker/index.ts`; Tests `test/agent/chat.test.ts`, `test/http/routing.test.ts`, `test/limits/rate-window.test.ts`

**Interfaces — Produces (RPC, `@callable()`):** `sendMessage(text): Promise<RpcResult>`, `chooseQuickReply(label)`, `startOver()`; `RpcResult = {ok:true}|{ok:false; error:"rate_limited"|"too_long"|"empty"|"graduated"}`. Worker: `GET /` sets `sid` cookie if absent; `/agents/onboarding-agent/me` rewritten to the cookie's sid (403 without cookie); `POST /api/reset` rotates sid.

- [ ] Step 1: Tests: first connect posts the deterministic greeting exactly once (not on reconnect); `sendMessage` persists user msg, runs turn, broadcasts; five rapid messages → one coalesced LLM turn containing all five (Review Focus 4); 1,001 chars → `too_long`; whitespace → `empty`; 41st message in window → `rate_limited`; client `setState` rejected; `/agents/onboarding-agent/other-sid` returns 403; missing cookie → 403; reset gives a fresh session; reconnect restores state (Review Focus 5); idle nudge fires once after 2 min of silence mid-onboarding and never again, and never during a call or after graduation.
- [ ] Steps 2–5 → commit `feat: onboarding agent chat path`.

### Task 8: Live call — API, sideband, controller, budget

**Files:** `src/worker/live/{events,live-api,sideband,transcript,call-controller}.ts`, `src/worker/limits/budget.ts`, `src/worker/conductor/{extraction,followup}.ts`, modify agent; Tests `test/live/*.test.ts`

**Interfaces — Produces:**
- `createLiveSession(apiKey, {state, sdp}, fetchImpl): Promise<{sessionId, answerSdp}>`
- `class Sideband { static open(apiKey, sessionId, handlers, fetchImpl): Promise<Sideband>; send(cmd): void; close(): void }` — handlers: `onEvent(LiveEvent)`, `onSocketClosed()`.
- `class CallController` (owned by the agent; state access via callbacks): `ring()`, `accept(sdp): Promise<{answerSdp}>`, `decline()`, `hangup(reason)`, `onRingTimeout()`, `onMaxDuration()`, `notifyExternalChange(summary)`.
- Agent RPC: `requestCall()`, `acceptCall(sdp)`, `declineCall()`, `endCall(reason)`, `reportCallFailure(reason)`; HTTP `POST /api/call-ended` (beacon).
- `BudgetDO.reserve(minutes): boolean`, `BudgetDO.record(seconds)`.
- `extractFromTranscript(llm, transcript, state)` → slot proposals validated through `executeTool(channel:"voice")`.
- `composeFollowup(llm, state, reason)` → assistant message + quick replies.

- [ ] Step 1: Tests with a fake Sideband + stubbed live API: accept creates exactly one session even if called twice concurrently (Review Focus 1); function call event → tool executed → `function_call_output` + `response.create` sent in order; unknown event ignored; each `session.closed.reason` maps to the right `CallEndReason`; socket closed without `session.closed` → `dropped`; attach fails 3× → session closed + `connection_failed` + text fallback message; ring timeout → `no_answer` follow-up; max duration → `session.close` sent; transcript with a name but no tool call → extraction fills it and follow-up mentions it (Review Focus 2); budget exhausted → `budget_exhausted` notice without creating a session; Gmail completion during a call → `thinking.append` + backend `session.update` sent.
- [ ] Steps 2–5 → commit `feat: gpt-live call controller`.

### Task 9: Gmail OAuth + inbox insight

**Files:** `src/worker/gmail/{oauth-state,google}.ts`, routes in `src/worker/index.ts`, agent RPC `beginGmail()` / internal `completeGmail()`; Tests `test/gmail/*.test.ts`

**Interfaces — Produces:** `signState(secret, {sid, nonce, exp})`, `verifyState(secret, token, now)`; `buildAuthUrl(cfg, state)`, `exchangeCode`, `fetchUserinfo`, `fetchInboxSnapshot(token): {unreadCount, topSenders:{name,count}[], sampleSubjects:string[]}`; routes `GET /auth/google/start`, `GET /auth/google/callback`.

- [ ] Step 1: Tests: state round-trips; tampered/expired state rejected; nonce single-use (replay → error page, state unchanged) (Review Focus 3); consent `error=access_denied` → `declined`; gmail scope missing → `connected_limited`; snapshot aggregation from stubbed Gmail responses; completion after graduation still updates state and posts insight card; missing Google config → start route renders "not configured" page and agent shows a notice instead of a broken button; tokens never appear in stored state (assert JSON of state has no `ya29`/`access_token`).
- [ ] Steps 2–5 → commit `feat: gmail oauth and inbox insight`.

### Task 10: Client — session hook, phone UI, chat

**Files:** `src/client/**` (components listed in File Structure)

**Interfaces — Consumes:** `useAgent({agent:"onboarding-agent", name:"me"})`, RPC names from `src/shared/rpc.ts`.

- [ ] Step 1: Build `useSession()` (state, connection status, `call(method,...args)` with error toasts).
- [ ] Step 2: Phone frame, iMessage styles, header with live agent name/avatar, bubbles, typing indicator (pending turn flag in state), quick replies, composer with 1,000-char guard, cards (gmail connect/connected, insight, call summary with duration + transcript), Behind-the-scenes panel (desktop ≥1024px), Start over.
- [ ] Step 3: Home screen when `phase === "graduated"`.
- [ ] Step 4: Manual check in browser pane at mobile and desktop widths; commit `feat: phone simulator chat ui`.

### Task 11: Client — call UI + WebRTC

**Files:** `src/client/call/live-call.ts`, `IncomingCall.tsx`, `ActiveCall.tsx`, `InCallPill.tsx`

- [ ] Step 1: `LiveCall.start({exchangeSdp})`: getUserMedia (mic-denied → `reportCallFailure("mic_denied")`), peer connection, `oai-events` channel, ICE gather (10s cap), exchange via `acceptCall`, remote audio playback, captions from transcript deltas, `connectionstatechange=failed` → `reportCallFailure("connection_failed")`, `pagehide` → `sendBeacon('/api/call-ended')`, `end()` sends `session.close` and waits ≤15s for `session.closed`.
- [ ] Step 2: Incoming call screen (ringtone via WebAudio, Accept/Decline), active call (timer, audio-level bars, captions, mute, speaker, back to Messages), green in-call pill.
- [ ] Step 3: Real call in the browser pane; commit `feat: live call ui`.

### Task 12: E2E + chaos, deploy, secrets, docs

**Files:** `playwright.config.ts`, `e2e/{chat-flow,call-decline,graduate-early,refresh-resume,live-call.real}.spec.ts`, `README.md`

- [ ] Step 1: Playwright against `wrangler dev` with `FAKE_LLM=1`: happy text path; decline call → text completion; early graduation with one nudge; refresh mid-flow resumes; multi-slot utterance.
- [ ] Step 2: `live-call.real.spec.ts` (opt-in `LIVE_E2E=1`): fake-mic WAV script through a real GPT-Live call; asserts name + goal filled and a hangup mid-call produces a recovery message.
- [ ] Step 3: `pnpm test --coverage` ≥ 80% on `src/worker`.
- [ ] Step 4: `wrangler secret put` for `OPENAI_API_KEY`, `OAUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; `pnpm deploy`; smoke-test the public URL in the browser pane; README with architecture, how to test, known limits.
- [ ] Step 5: Commit `test: e2e and deploy`.
