import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          OPENAI_API_KEY: "test-openai-key",
          OAUTH_STATE_SECRET: "test-oauth-state-secret-0123456789abcdef",
          GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test-client-secret",
          FAKE_LLM: "1",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
