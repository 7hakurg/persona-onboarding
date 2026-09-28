export type Channel = "text" | "voice";
export type SlotKey = "agentName" | "userName" | "helpGoal";
export type MissingKey = SlotKey | "gmail";

export type Slot<T> =
  | { status: "empty" }
  | { status: "pending_confirmation"; value: T; source: Channel }
  | { status: "filled"; value: T; source: Channel; at: number }
  | { status: "defaulted"; value: T }
  | { status: "parked"; attempts: number };

export interface InboxSnapshot {
  unreadCount: number;
  topSenders: { name: string; count: number }[];
  sampleSubjects: string[];
}

export type GmailState =
  | { status: "not_connected" }
  | { status: "link_sent"; at: number }
  | { status: "declined"; at: number }
  | { status: "connected_limited"; email: string }
  | { status: "connected"; email: string; snapshot: InboxSnapshot; insight: string; canManage?: boolean }
  | { status: "error"; reason: string };

export type CallEndReason =
  | "completed"
  | "user_hangup"
  | "declined"
  | "no_answer"
  | "mic_denied"
  | "connection_failed"
  | "dropped"
  | "max_duration"
  | "page_closed"
  | "moderated"
  | "budget_exhausted";

export type CallState =
  | { status: "idle" }
  | { status: "ringing"; callId: string; since: number }
  | { status: "connecting"; callId: string; since: number }
  | { status: "active"; callId: string; liveSessionId: string; since: number; usedSeconds: number }
  | { status: "ended"; callId: string; reason: CallEndReason; at: number; durationMs: number };

export type Phase = "naming" | "calling" | "collecting_text" | "wrapup" | "graduated";

export type Goal =
  | "name_agent"
  | "offer_call"
  | "on_call"
  | "confirm_user_name"
  | "user_name"
  | "help_goal"
  | "gmail"
  | "wrap_up"
  | "done";

export interface TranscriptLine {
  speaker: "user" | "assistant";
  text: string;
}

export interface TriageItem {
  threadId: string;
  from: string;
  subject: string;
  summary: string;
  urgency: "high" | "medium" | "low";
  action: "reply" | "read" | "archive" | "none";
}

export type CardData =
  | { card: "call"; outcome: CallEndReason; durationMs: number; transcript: TranscriptLine[] }
  | { card: "gmail"; status: "pending" | "connected" | "limited" | "declined"; email?: string }
  | { card: "insight"; email: string; unreadCount: number; topSenders: { name: string; count: number }[]; insight: string }
  | { card: "triage"; items: TriageItem[] }
  | { card: "draft"; threadId: string; to: string; subject: string; body: string; gmailUrl: string }
  | { card: "archived"; threadIds: string[]; count: number; undone: boolean };

export interface ChatMessage {
  id: string;
  at: number;
  role: "user" | "assistant" | "system";
  kind: "text" | "card" | "notice";
  text: string;
  data?: CardData;
}

export interface SessionEvent {
  at: number;
  type: string;
  detail: string;
}

export interface SessionState {
  version: 1;
  slots: { agentName: Slot<string>; userName: Slot<string>; helpGoal: Slot<string> };
  invalidAttempts: Record<SlotKey, number>;
  gmail: GmailState;
  call: CallState;
  callAttempts: number;
  messages: ChatMessage[];
  events: SessionEvent[];
  nudges: { gmailBeforeGraduate: boolean; idle: boolean };
  turnPending: boolean;
  graduatedAt: number | null;
  createdAt: number;
}
