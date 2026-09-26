import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { OnboardingAgent } from "../../src/worker/agent/onboarding-agent";

let n = 0;
export async function agentNamed(name: string): Promise<DurableObjectStub<OnboardingAgent>> {
  const stub = await getAgentByName(env.ONBOARDING_AGENT as never, name);
  return stub as unknown as DurableObjectStub<OnboardingAgent>;
}

export async function freshAgent(): Promise<DurableObjectStub<OnboardingAgent>> {
  const stub = await agentNamed(`test-${Date.now()}-${++n}`);
  await stub.ensureGreeted();
  return stub;
}
