import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit tests: pure helpers, the API client, the host <-> page connection, store
// actions, error regions, the inspector, and the page bridge (run in jsdom).
// End-to-end tests against the real app live in ../e2e (Playwright).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
