import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { OnboardingAgent } from "../../src/worker/agent/onboarding-agent";
import { FALLBACK_REPLY } from "../../src/worker/conductor/prompts";
import { appendMessage, setTurnPending } from "../../src/worker/state/reducers";
import { freshAgent } from "./helpers";

describe("turn recovery", () => {
  it("clears the typing indicator and replies when a turn throws before the model runs", async () => {
    const stub = await freshAgent();
    await runInDurableObject(stub, async (agent: OnboardingAgent) => {
      (agent as unknown as { llm: () => never }).llm = () => {
        throw new Error("Missing required secret: OPENAI_API_KEY");
      };
      await agent.sendMessage("hi");
      await agent.whenIdle();
      expect(agent.state.turnPending).toBe(false);
      expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant", text: FALLBACK_REPLY });
    });
  });

  it("answers a message left pending by a restart", async () => {
    const stub = await freshAgent();
    await runInDurableObject(stub, async (agent: OnboardingAgent) => {
      const stuck = setTurnPending(appendMessage(agent.state, { id: "u1", at: Date.now(), role: "user", kind: "text", text: "Friday" }), true);
      agent.setState(stuck);
      await agent.onStart();
      await agent.whenIdle();
      expect(agent.state.turnPending).toBe(false);
      expect(agent.state.messages.at(-1)?.role).toBe("assistant");
      expect(agent.state.slots.agentName).toMatchObject({ value: "Friday" });
    });
  });
});
