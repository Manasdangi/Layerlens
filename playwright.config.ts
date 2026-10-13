import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: the real app (Vite dev server, so the Dev faults menu exists)
// against the real mock backend, in Chromium. `npm run test:e2e` starts both on
// their own ports, so a running `npm run dev` (4000 / 4001 / 5173) is never reused.
const API = 4100;
const PAGES = 4101;
const APP = 5273;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${APP}`,
    // Wide enough for the first rows of previews to be fully on screen at 25%.
    viewport: { width: 2100, height: 1200 },
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { viewport: { width: 2100, height: 1200 } } }],
  webServer: [
    {
      command: "node backend/server.js",
      url: `http://localhost:${API}/screens`,
      env: { API_PORT: String(API), PAGES_PORT: String(PAGES), PAGES_ORIGIN: `http://localhost:${PAGES}` },
    },
    {
      command: `npm --prefix frontend run dev -- --port ${APP}`,
      url: `http://localhost:${APP}`,
      env: { VITE_API_URL: `http://localhost:${API}` },
    },
  ],
});
