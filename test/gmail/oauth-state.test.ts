import { describe, expect, it } from "vitest";
import { signState, verifyState } from "../../src/worker/gmail/oauth-state";

const SECRET = "secret-0123456789abcdef-0123456789";

describe("oauth state", () => {
  it("round-trips", async () => {
    const token = await signState(SECRET, { sid: "a".repeat(32), nonce: "n1", exp: 2_000 });
    expect(await verifyState(SECRET, token, 1_000)).toEqual({ sid: "a".repeat(32), nonce: "n1", exp: 2_000 });
  });
  it("rejects tampering, wrong secrets, expiry and junk", async () => {
    const token = await signState(SECRET, { sid: "a".repeat(32), nonce: "n1", exp: 2_000 });
    const [body, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ sid: "b".repeat(32), nonce: "n1", exp: 2_000 })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(await verifyState(SECRET, `${forged}.${sig}`, 1_000)).toBeNull();
    expect(await verifyState("other-secret-0123456789abcdef", token, 1_000)).toBeNull();
    expect(await verifyState(SECRET, token, 3_000)).toBeNull();
    expect(await verifyState(SECRET, `${body}`, 1_000)).toBeNull();
    expect(await verifyState(SECRET, "!!!.???", 1_000)).toBeNull();
  });
});
