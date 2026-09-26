import { describe, expect, it } from "vitest";
import { createFakeLlm } from "../../src/worker/llm/fake-llm";
import { toolDefinitions } from "../../src/worker/conductor/tools";

const tools = toolDefinitions("text");
const user = (content: string) => ({ type: "message" as const, role: "user" as const, content });

describe("createFakeLlm", () => {
  it("extracts several facts from one message", async () => {
    const res = await createFakeLlm().respond({ instructions: "Current goal: name_agent", tools, input: [user("lol ok im sam, call yourself jarvis. i need help with my email")] });
    expect(res.calls.map((c) => c.name).sort()).toEqual(["set_agent_name", "set_help_goal", "set_user_name"]);
  });
  it("treats a short reply as the agent name while naming", async () => {
    const res = await createFakeLlm().respond({ instructions: "Current goal: name_agent", tools, input: [user("Friday")] });
    expect(res.calls).toEqual([{ callId: expect.any(String), name: "set_agent_name", argsJson: JSON.stringify({ name: "Friday" }) }]);
  });
  it("replies with text after tool outputs", async () => {
    const res = await createFakeLlm().respond({
      instructions: "Current goal: offer_call",
      tools,
      input: [user("Friday"), { type: "function_call", call_id: "c", name: "set_agent_name", arguments: "{}" }, { type: "function_call_output", call_id: "c", output: "{}" }],
    });
    expect(res.calls).toEqual([]);
    expect(res.outputText.length).toBeGreaterThan(0);
  });
  it("maps quick replies to actions", async () => {
    const llm = createFakeLlm();
    const call = await llm.respond({ instructions: "Current goal: offer_call", tools, input: [user("Call me")] });
    expect(call.calls[0]?.name).toBe("start_call");
    const skip = await llm.respond({ instructions: "Current goal: offer_call", tools, input: [user("Skip to the app")] });
    expect(skip.calls[0]?.name).toBe("graduate");
    const gmail = await llm.respond({ instructions: "Current goal: gmail", tools, input: [user("Connect Gmail")] });
    expect(gmail.calls[0]?.name).toBe("send_gmail_link");
  });
  it("returns JSON for structured requests", async () => {
    const schema = { type: "object" as const, properties: {}, required: [], additionalProperties: false as const };
    const res = await createFakeLlm().respond({ instructions: "x", input: [user("USER: my name is Sam\nUSER: I need help with travel")], json: { name: "extract", schema } });
    expect(JSON.parse(res.outputText)).toEqual({ userName: "Sam", helpGoal: "travel" });
  });
});

describe("fake gmail nudge", () => {
  it("nudges about gmail when graduate asks for it", async () => {
    const res = await createFakeLlm().respond({
      instructions: "Current goal: offer_call",
      tools,
      input: [user("skip"), { type: "function_call", call_id: "c", name: "graduate", arguments: "{}" }, { type: "function_call_output", call_id: "c", output: "{\"ok\":false,\"error\":\"nudge_first\"}" }],
    });
    expect(res.outputText).toMatch(/gmail/i);
  });
});
