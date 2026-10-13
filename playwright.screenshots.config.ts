import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The README screenshots (`npm run screenshots`): same servers as the e2e tests.
export default defineConfig({
  ...base,
  testDir: "scripts",
  testMatch: "screenshots.spec.ts",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: "list",
});
