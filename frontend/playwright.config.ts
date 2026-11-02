import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", colorScheme: "light", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
  webServer: [
    {
      command: "cd ../backend && AVRORA_LLM=none uv run uvicorn avrora.api.main:app --port 8000",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
    },
    { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
  ],
});
