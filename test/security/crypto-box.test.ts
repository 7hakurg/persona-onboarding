import { describe, expect, it } from "vitest";
import { decryptString, encryptString } from "../../src/worker/security/crypto-box";

const KEY = "k".repeat(32);

describe("crypto-box", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptString(KEY, "1//refresh-token");
    const b = await encryptString(KEY, "1//refresh-token");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(await decryptString(KEY, a)).toBe("1//refresh-token");
  });
  it("returns null for a wrong key, tampering, or junk", async () => {
    const box = await encryptString(KEY, "secret");
    expect(await decryptString("x".repeat(32), box)).toBeNull();
    const tampered = box.slice(0, -2) + (box.endsWith("A") ? "BB" : "AA");
    expect(await decryptString(KEY, tampered)).toBeNull();
    expect(await decryptString(KEY, "not-a-box")).toBeNull();
  });
  it("rejects short keys", async () => {
    await expect(encryptString("short", "x")).rejects.toThrow(/at least 32/);
  });
});
