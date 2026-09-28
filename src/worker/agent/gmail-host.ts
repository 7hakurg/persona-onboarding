import type { CardData, SessionState } from "../../shared/types";
import { CONFIG } from "../config";
import { googleConfig, requireSecret, type Env } from "../env";
import type { GmailHost } from "../gmail/assistant";
import { revokeToken } from "../gmail/google";
import { GmailTokenStore } from "../gmail/token-store";
import { slidingWindow } from "../limits/rate-window";
import type { LlmClient } from "../llm/types";
import { errorFields, log } from "../log";

const ACTIONS_KEY = "gmail-actions";

export interface GmailHostAgent {
  readonly state: SessionState;
  setState(state: SessionState): void;
  say(text: string, data?: CardData): void;
  llm(): LlmClient;
}

/** Lazily built so sessions without Google config (or tests) never need the secrets. */
export function createTokenStore(storage: DurableObjectStorage, env: Env): GmailTokenStore {
  const google = googleConfig(env);
  if (!google) throw new Error("Google OAuth is not configured");
  return new GmailTokenStore(storage, { ...google, encryptionKey: requireSecret(env, "TOKEN_ENCRYPTION_KEY") });
}

export function createGmailHost(agent: GmailHostAgent, storage: DurableObjectStorage, tokens: () => GmailTokenStore): GmailHost {
  return {
    getState: () => agent.state,
    setState: (next) => agent.setState(next),
    say: (text, data) => agent.say(text, data),
    llm: () => agent.llm(),
    now: () => Date.now(),
    allowAction: async () => {
      const hits = (await storage.get<number[]>(ACTIONS_KEY)) ?? [];
      const r = slidingWindow(hits, Date.now(), CONFIG.limits.gmailActionsPerWindow, CONFIG.limits.gmailActionWindowMs);
      await storage.put(ACTIONS_KEY, r.hits);
      return r.allowed;
    },
    forgetCredentials: async () => {
      const refresh = await tokens().clear();
      if (!refresh) return;
      try {
        await revokeToken(refresh);
      } catch (err) {
        log("warn", "gmail_revoke_failed", errorFields(err));
      }
    },
  };
}
