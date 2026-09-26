import { z } from "zod";
import type { Channel } from "../../shared/types";
import type { FunctionTool, JsonSchemaObject } from "../llm/types";

export type ToolName =
  | "set_agent_name"
  | "set_user_name"
  | "set_help_goal"
  | "send_gmail_link"
  | "check_gmail_status"
  | "skip_gmail"
  | "start_call"
  | "end_call"
  | "graduate";

const empty: JsonSchemaObject = { type: "object", properties: {}, required: [], additionalProperties: false };
const str = (description: string) => ({ type: "string", description });

interface ToolSpec {
  description: string;
  parameters: JsonSchemaObject;
  args: z.ZodType;
  channels: readonly Channel[];
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  set_agent_name: {
    description: "Save the name the user chose for you (the assistant). On a call, only when the user explicitly asks to rename you.",
    parameters: { type: "object", properties: { name: str("The assistant's new name, exactly as the user wants it") }, required: ["name"], additionalProperties: false },
    args: z.object({ name: z.string() }),
    channels: ["text", "voice"],
  },
  set_user_name: {
    description: "Save the user's name. Set confirmed=true only when re-saving a name the user just confirmed after you asked.",
    parameters: {
      type: "object",
      properties: { name: str("The user's name as they want to be called"), confirmed: { type: "boolean", description: "True only when the user confirmed an unusual name you asked about" } },
      required: ["name", "confirmed"],
      additionalProperties: false,
    },
    args: z.object({ name: z.string(), confirmed: z.boolean() }),
    channels: ["text", "voice"],
  },
  set_help_goal: {
    description: "Save what the user wants help with, summarized in their own words (max one sentence).",
    parameters: { type: "object", properties: { goal: str("What the user wants help with") }, required: ["goal"], additionalProperties: false },
    args: z.object({ goal: z.string() }),
    channels: ["text", "voice"],
  },
  send_gmail_link: {
    description: "Put a 'Connect Gmail' button in the user's chat. Use when the user agrees to connect Gmail.",
    parameters: empty,
    args: z.object({}),
    channels: ["text", "voice"],
  },
  skip_gmail: {
    description: "Record that the user doesn't want to connect Gmail right now, so you stop asking and move on.",
    parameters: empty,
    args: z.object({}),
    channels: ["text", "voice"],
  },
  check_gmail_status: {
    description: "Check whether the user has finished connecting Gmail.",
    parameters: empty,
    args: z.object({}),
    channels: ["text", "voice"],
  },
  start_call: {
    description: "Ring the user's phone for a quick setup call. Use when the user agrees to a call or asks you to call.",
    parameters: empty,
    args: z.object({}),
    channels: ["text"],
  },
  end_call: {
    description: "End the call after you have said goodbye, or when the user asks to hang up.",
    parameters: empty,
    args: z.object({}),
    channels: ["voice"],
  },
  graduate: {
    description: "Finish onboarding and take the user into the main app. Use when the user wants to skip ahead or everything is done.",
    parameters: empty,
    args: z.object({}),
    channels: ["text", "voice"],
  },
};

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_SPECS, name);
}

export function toolDefinitions(channel: Channel): FunctionTool[] {
  return (Object.keys(TOOL_SPECS) as ToolName[])
    .filter((name) => TOOL_SPECS[name].channels.includes(channel))
    .map((name) => ({
      type: "function",
      name,
      description: TOOL_SPECS[name].description,
      parameters: TOOL_SPECS[name].parameters,
      strict: true,
    }));
}
