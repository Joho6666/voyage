import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT || "3005";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER
    ? undefined
    : {
        command: `npx next build --turbopack && npx next start -p ${port}`,
        // E2E is deterministic and explicit demo mode. Live AMap validation runs separately.
        env: {
          ...process.env,
          NEXT_PUBLIC_AMAP_KEY: "",
          NEXT_PUBLIC_AMAP_SECURITY_CODE: "",
          AMAP_SERVER_KEY: "",
          MEITUAN_HT_TOKEN: "",
          FLIGGY_APP_KEY: "",
          FLIGGY_APP_SECRET: "",
          FLIGGY_SESSION: "",
          FLIGGY_DISTRIBUTOR: "",
          FLIGGY_API_URL: "",
          FLIGGY_EXTERNAL_AGENT_NAME: "",
          TIKHUB_API_KEY: "",
          REDFOX_API_KEY: "",
          VOYAGE_DEMO_MODE: "true",
          VOYAGE_LLM_ENABLED: "0",
          VOYAGE_SKIP_LOCAL_CREDENTIALS: "1",
          VOYAGE_SOCIAL_ENABLED: "0",
        },
        url: `http://localhost:${port}`,
        // Never reuse a server built with a different provider/key environment.
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
