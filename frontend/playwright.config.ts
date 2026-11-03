import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, colorScheme: "light", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
  // BASE_URL=https://… tests a deployed copy; otherwise both local servers are started.
  webServer: process.env.BASE_URL ? undefined : [
    {
      command: "cd ../backend && AVRORA_LLM=none uv run uvicorn avrora.api.main:app --port 8000",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
    },
    { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
  ],
});
