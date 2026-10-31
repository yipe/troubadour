import { defineConfig } from "vitest/config"

// One vitest process for the whole workspace. Each project has its own config.
export default defineConfig({
  test: {
    projects: ["app/vitest.config.ts", "app/vitest.browser.config.ts", "packages/*"],
    // Vitest's performance hints repeat on every run; one fresh jsdom per file is deliberate (no shared state).
    experimental: { diagnostics: { environment: false, isolate: false, import: false, transform: false } },
  },
})
