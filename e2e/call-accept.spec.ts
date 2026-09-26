import { expect, test } from "@playwright/test";
import { conversation, openFresh, tapChip } from "./helpers";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("double-tapping Accept starts exactly one call attempt", async ({ page }) => {
  let accepts = 0;
  page.on("websocket", (ws) => ws.on("framesent", (f) => {
    if (typeof f.payload === "string" && f.payload.includes("\"acceptCall\"")) accepts += 1;
  }));
  await openFresh(page);
  await tapChip(page, "Friday");
  await tapChip(page, "Call me");
  const accept = page.getByRole("dialog", { name: /Incoming call/ }).getByRole("button", { name: "Accept" });
  await accept.dblclick();
  // Fake mode cannot create a live session, so the call fails over to text.
  await expect(conversation(page)).toContainText("Call failed", { timeout: 15_000 });
  expect(accepts).toBe(1);
});
