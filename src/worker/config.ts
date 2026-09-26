/** All tunables live here. Values may be overridden by Worker vars in env.ts. */
export const CONFIG = {
  models: {
    chat: "gpt-6-luna",
    chatReasoningEffort: "low",
    live: "gpt-live-1",
    liveVoice: "marin",
    liveBackend: "gpt-6-luna",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    requestTimeoutMs: 20_000,
  },
  limits: {
    chatMessagesPerWindow: 40,
    chatWindowMs: 10 * 60_000,
    maxMessageChars: 1_000,
    callsPerSession: 5,
    maxCallMs: 5 * 60_000,
    ringTimeoutMs: 30_000,
    dailyVoiceMinutes: 300,
    toolLoopMaxIterations: 4,
    maxSlotAttempts: 2,
  },
  history: {
    maxMessages: 200,
    maxEvents: 100,
    chatContextMessages: 30,
    liveSeedMessages: 20,
  },
  timing: {
    idleNudgeMs: 2 * 60_000,
    sidebandAttachRetries: 3,
    goodbyeGraceMs: 8_000,
    turnDebounceMs: 400,
  },
  gmail: {
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    stateTtlMs: 10 * 60_000,
    unreadLookbackQuery: "is:unread newer_than:7d",
    maxMessages: 50,
  },
  cookie: {
    name: "sid",
    maxAgeSeconds: 60 * 60 * 24 * 30,
  },
} as const;

export type Config = typeof CONFIG;
