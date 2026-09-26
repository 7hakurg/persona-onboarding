import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const FAKE_PORT = 8788;
const LIVE_URL = process.env.LIVE_E2E_URL ?? "http://localhost:5173";
const live = process.env.LIVE_E2E === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  projects: [
    {
      name: "fake",
      testIgnore: /\.real\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${FAKE_PORT}` },
    },
    ...(live
      ? [
          {
            name: "live",
            testMatch: /\.real\.spec\.ts$/,
            timeout: 180_000,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: LIVE_URL,
              permissions: ["microphone"],
              launchOptions: {
                args: [
                  "--use-fake-ui-for-media-stream",
                  "--use-fake-device-for-media-stream",
                  `--use-file-for-fake-audio-capture=${resolve("e2e/fixtures/caller.wav")}%noloop`,
                  "--autoplay-policy=no-user-gesture-required",
                ],
              },
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm build && pnpm exec wrangler dev --config dist/persona_onboarding/wrangler.json --port ${FAKE_PORT} --var FAKE_LLM:1 --var OAUTH_STATE_SECRET:e2e-state-secret-0123456789abcdef`,
    url: `http://localhost:${FAKE_PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
