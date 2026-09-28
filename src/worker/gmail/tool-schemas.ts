import { z } from "zod";
import type { FunctionTool } from "../llm/types";

export const MAX_ARCHIVE = 25;

export const GMAIL_TOOL_ARGS = {
  gmail_search: z.object({ query: z.string().min(1).max(300) }),
  gmail_summarize_thread: z.object({ thread_id: z.string().min(1).max(64) }),
  gmail_archive: z.object({ thread_ids: z.array(z.string().min(1).max(64)).min(1) }),
  gmail_draft_reply: z.object({ thread_id: z.string().min(1).max(64), instructions: z.string().min(1).max(1_000) }),
} as const;

export type GmailToolName = keyof typeof GMAIL_TOOL_ARGS;

export function isGmailTool(name: string): name is GmailToolName {
  return Object.hasOwn(GMAIL_TOOL_ARGS, name);
}

const str = (description: string) => ({ type: "string", description });

export const GMAIL_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "gmail_search",
    description: "Search the user's Gmail using Gmail search syntax (e.g. 'is:unread', 'from:priya', 'newer_than:3d'). Returns thread ids, senders, subjects.",
    parameters: { type: "object", properties: { query: str("Gmail search query") }, required: ["query"], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "gmail_summarize_thread",
    description: "Read one email thread and summarize it for the user.",
    parameters: { type: "object", properties: { thread_id: str("Thread id from gmail_search or the triage card") }, required: ["thread_id"], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "gmail_archive",
    description: `Archive threads (removes them from the inbox; undoable). Only when the user explicitly asks. At most ${MAX_ARCHIVE} at once.`,
    parameters: { type: "object", properties: { thread_ids: { type: "array", items: { type: "string" }, description: "Thread ids to archive" } }, required: ["thread_ids"], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "gmail_draft_reply",
    description: "Write a reply as a Gmail DRAFT in the thread (never sent). Use when the user asks you to reply or draft something.",
    parameters: {
      type: "object",
      properties: { thread_id: str("Thread to reply in"), instructions: str("What the reply should say, in the user's words") },
      required: ["thread_id", "instructions"],
      additionalProperties: false,
    },
    strict: true,
  },
];
