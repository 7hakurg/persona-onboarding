import { describe, expect, it } from "vitest";
import { openSideband } from "../../src/worker/live/sideband";
import type { LiveEvent } from "../../src/worker/live/events";

function pairFetch() {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  const sent: unknown[] = [];
  server.addEventListener("message", (e) => sent.push(JSON.parse(String(e.data))));
  let request: { url: string; headers: Headers } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    request = { url, headers: new Headers(init.headers) };
    return new Response(null, { status: 101, webSocket: pair[0] });
  }) as unknown as typeof fetch;
  return { fetchImpl, server, sent, request: () => request };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("openSideband", () => {
  it("attaches with auth and relays events both ways", async () => {
    const p = pairFetch();
    const events: LiveEvent[] = [];
    let closed = false;
    const sb = await openSideband({ apiKey: "k", sessionId: "live_1", fetchImpl: p.fetchImpl, handlers: { onEvent: (e) => events.push(e), onClosed: () => (closed = true) } });
    expect(p.request()?.url).toBe("https://api.openai.com/v1/live/sessions/live_1/attach");
    expect(p.request()?.headers.get("authorization")).toBe("Bearer k");
    expect(p.request()?.headers.get("upgrade")).toBe("websocket");
    p.server.send(JSON.stringify({ type: "session.usage.updated", usage: { seconds: 3 } }));
    sb.send({ type: "session.close" });
    await tick();
    expect(events).toEqual([{ kind: "usage", seconds: 3 }]);
    expect(p.sent).toEqual([{ type: "session.close" }]);
    p.server.close(1000, "done");
    await tick();
    expect(closed).toBe(true);
  });

  it("fails when the upgrade is refused", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(openSideband({ apiKey: "k", sessionId: "x", fetchImpl, handlers: { onEvent: () => {}, onClosed: () => {} } })).rejects.toThrow(/attach failed/);
  });

  it("does not throw when sending after close", async () => {
    const p = pairFetch();
    const sb = await openSideband({ apiKey: "k", sessionId: "s", fetchImpl: p.fetchImpl, handlers: { onEvent: () => {}, onClosed: () => {} } });
    sb.close();
    expect(() => sb.send({ type: "session.close" })).not.toThrow();
  });
});

describe("sideband command shapes (verified against GPT-Live)", () => {
  it("session.update names the delegation type, or GPT-Live rejects it with missing_required_parameter", async () => {
    const { commands } = await import("../../src/worker/live/sideband");
    expect(commands.updateBackend({ instructions: "x" })).toEqual({
      type: "session.update",
      session: { delegation: { type: "responses", responses: { instructions: "x" } } },
    });
  });
});
