import { expect, test } from "@playwright/test";
import { conversation, openFresh, panel, say, tapChip } from "./helpers";

test("captures several facts from one messy message", async ({ page }) => {
  await openFresh(page);
  await say(page, "lol ok im sam, call yourself jarvis. i need help with my email");
  await expect(panel(page)).toContainText("✓ Jarvis (text)");
  await expect(panel(page)).toContainText("✓ Sam (text)");
  await expect(panel(page)).toContainText("✓ email (text)");
  await expect(page.getByRole("button", { name: "Call Jarvis" })).toBeVisible();
});

test("declining the call continues over text", async ({ page }) => {
  await openFresh(page);
  await tapChip(page, "Friday");
  await expect(panel(page)).toContainText("✓ Friday (text)");
  await tapChip(page, "Call me");
  await page.getByRole("dialog", { name: "Incoming call from Friday" }).getByRole("button", { name: "Decline" }).click();
  await expect(conversation(page)).toContainText("Declined call");
  await expect(panel(page)).toContainText("ended · declined");
  await expect(page.getByRole("group", { name: "Suggested replies" })).toContainText("Call me back");
  await say(page, "my name is Priya");
  await expect(panel(page)).toContainText("✓ Priya (text)");
});

test("graduating early nudges about gmail once, then lets the user in", async ({ page }) => {
  await openFresh(page);
  await tapChip(page, "Friday");
  await expect(panel(page)).toContainText("✓ Friday (text)");
  await tapChip(page, "Skip to the app");
  await expect(conversation(page)).toContainText("connecting Gmail is where I'm most useful");
  await expect(page.getByRole("heading", { name: /Welcome in|Hi,/ })).toHaveCount(0);
  await say(page, "Skip to the app");
  await expect(page.getByRole("heading", { name: /Welcome in/ })).toBeVisible();
  await expect(page.getByText("What Friday knows")).toBeVisible();
  await page.getByRole("button", { name: "Message" }).click();
  await expect(conversation(page)).toBeVisible();
});

test("refreshing mid-flow resumes the same session", async ({ page }) => {
  await openFresh(page);
  await say(page, "call yourself Nova");
  await expect(panel(page)).toContainText("✓ Nova (text)");
  await page.reload();
  await expect(panel(page)).toContainText("✓ Nova (text)");
  await expect(conversation(page).getByText("what do you want to call me?")).toHaveCount(1);
});

test("start over gives a brand-new session", async ({ page }) => {
  await openFresh(page);
  await say(page, "call yourself Nova");
  await expect(panel(page)).toContainText("✓ Nova (text)");
  await panel(page).getByRole("button", { name: "Start over" }).click();
  await expect(conversation(page)).toContainText("what do you want to call me?");
  await expect(panel(page)).not.toContainText("Nova");
});

test("rejects oversized messages without losing the draft", async ({ page }) => {
  await openFresh(page);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("x".repeat(1001));
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("a ringing call survives a refresh and still rings", async ({ page }) => {
  await openFresh(page);
  await tapChip(page, "Friday");
  await tapChip(page, "Call me");
  await expect(page.getByRole("dialog", { name: /Incoming call/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: /Incoming call/ })).toBeVisible();
});
