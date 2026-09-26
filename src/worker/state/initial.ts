import type { SessionState } from "../../shared/types";

export function createInitialState(now: number): SessionState {
  return {
    version: 1,
    slots: {
      agentName: { status: "empty" },
      userName: { status: "empty" },
      helpGoal: { status: "empty" },
    },
    invalidAttempts: { agentName: 0, userName: 0, helpGoal: 0 },
    gmail: { status: "not_connected" },
    call: { status: "idle" },
    callAttempts: 0,
    messages: [],
    events: [],
    nudges: { gmailBeforeGraduate: false, idle: false },
    turnPending: false,
    graduatedAt: null,
    createdAt: now,
  };
}
