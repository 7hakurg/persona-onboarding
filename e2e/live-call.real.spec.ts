import { expect, test } from "@playwright/test";
import { conversation, openFresh, panel, say } from "./helpers";

/**
 * Opt-in (LIVE_E2E=1): places a real GPT-Live call. The fake microphone plays
 * e2e/fixtures/caller.wav: "I'm Sam" … "help not drowning in my email" … "bye".
 */
test("a real call collects the name and goal through the server sideband", async ({ page }) => {
  await openFresh(page);
  await say(page, "call yourself Jarvis");
  await expect(panel(page)).toContainText("✓ Jarvis (text)", { timeout: 20_000 });
  await page.getByRole("button", { name: "Call Jarvis" }).click();
  await page.getByRole("dialog", { name: /Incoming call/ }).getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("dialog", { name: "Call with Jarvis" })).toBeVisible();
  await expect(panel(page)).toContainText("active", { timeout: 20_000 });
  await expect(panel(page)).toContainText("✓ Sam (voice)", { timeout: 60_000 });
  await expect(panel(page)).toContainText("(voice)", { timeout: 60_000 });
  await expect(panel(page).getByText(/Help goal/).locator("xpath=following-sibling::dd")).toContainText("(voice)", { timeout: 60_000 });
  await page.getByRole("button", { name: "End call" }).click();
  await expect(panel(page)).toContainText("ended ·", { timeout: 20_000 });
  await expect(conversation(page)).toContainText("Call ended");
  await conversation(page).getByRole("button", { name: "Transcript" }).click();
  await expect(conversation(page)).toContainText(/Sam/);
});

test("hanging up mid-call keeps what was said and follows up in text", async ({ page }) => {
  await openFresh(page);
  await say(page, "call yourself Jarvis");
  await expect(panel(page)).toContainText("✓ Jarvis (text)", { timeout: 20_000 });
  await page.getByRole("button", { name: "Call Jarvis" }).click();
  await page.getByRole("dialog", { name: /Incoming call/ }).getByRole("button", { name: "Accept" }).click();
  await expect(panel(page)).toContainText("✓ Sam (voice)", { timeout: 60_000 });
  const before = await conversation(page).locator(".bubble-in").count();
  await page.getByRole("button", { name: "End call" }).click();
  await expect(panel(page)).toContainText("ended · user_hangup", { timeout: 20_000 });
  await expect.poll(() => conversation(page).locator(".bubble-in").count(), { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.getByRole("group", { name: "Suggested replies" })).toBeVisible();
});
