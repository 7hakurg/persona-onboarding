import type { InboxSnapshot } from "../../shared/types";

/** Result of an OAuth round-trip, handed from the Worker route to the session's Durable Object. */
export type GmailCompletion =
  | { nonce: string; outcome: "declined" }
  | { nonce: string; outcome: "limited"; email: string }
  | { nonce: string; outcome: "connected"; email: string; snapshot: InboxSnapshot }
  | { nonce: string; outcome: "error"; reason: string };
