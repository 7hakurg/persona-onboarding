import type { CardData, SessionState } from "../../shared/types";
import type { Env } from "../env";
import { requireSecret } from "../env";
import { globalBudget } from "../limits/budget";
import type { CallHost, ScheduledCallback } from "../live/call-controller";
import { createLiveSession } from "../live/live-api";
import { openSideband } from "../live/sideband";
import type { LlmClient } from "../llm/types";

/** The subset of the agent a CallHost needs; keeps the adapter decoupled from the Agent class. */
export interface CallHostAgent {
  readonly state: SessionState;
  setState(state: SessionState): void;
  say(text: string, data?: CardData): void;
  llm(): LlmClient;
  scheduleCallback(delaySeconds: number, callback: ScheduledCallback, payload: { callId: string }): Promise<void>;
  keepAlive(): Promise<() => void>;
}

class LiveUnavailableError extends Error {
  constructor() {
    super("Live voice is disabled in fake mode");
    this.name = "LiveUnavailableError";
  }
}

export function createCallHost(agent: CallHostAgent, env: Env): CallHost {
  const budget = () => globalBudget(env);
  const fake = env.FAKE_LLM === "1";
  return {
    getState: () => agent.state,
    setState: (next) => agent.setState(next),
    say: (text, data) => agent.say(text, data),
    llm: () => agent.llm(),
    schedule: (delayMs, callback, payload) => agent.scheduleCallback(Math.max(1, Math.ceil(delayMs / 1000)), callback, payload),
    keepAlive: () => agent.keepAlive(),
    budget: {
      hasCapacity: () => budget().hasCapacity(),
      record: (seconds) => budget().record(seconds),
    },
    createSession: async (sdp, state) => {
      if (fake) throw new LiveUnavailableError();
      return createLiveSession({ apiKey: requireSecret(env, "OPENAI_API_KEY"), sdp, state });
    },
    openSideband: (sessionId, handlers) => openSideband({ apiKey: requireSecret(env, "OPENAI_API_KEY"), sessionId, handlers }),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
