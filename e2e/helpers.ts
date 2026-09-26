import { expect, type Page } from "@playwright/test";

export async function openFresh(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("what do you want to call me?");
}

export async function say(page: Page, text: string): Promise<void> {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
}

export async function tapChip(page: Page, label: string): Promise<void> {
  await page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: label, exact: true }).click();
}

export function conversation(page: Page) {
  return page.getByRole("log", { name: "Conversation" });
}

export function panel(page: Page) {
  return page.getByRole("complementary", { name: "Behind the scenes" });
}
