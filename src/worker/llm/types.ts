export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  strict: true;
}

export type InputItem =
  | { type: "message"; role: "user" | "assistant" | "developer"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface FunctionCall {
  callId: string;
  name: string;
  argsJson: string;
}

export interface LlmRequest {
  instructions: string;
  input: InputItem[];
  tools?: FunctionTool[];
  /** Structured output: the reply text is JSON matching this schema. */
  json?: { name: string; schema: JsonSchemaObject };
}

export interface LlmResponse {
  outputText: string;
  calls: FunctionCall[];
}

export interface LlmClient {
  respond(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    readonly code: "timeout" | "http_error" | "bad_response",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
