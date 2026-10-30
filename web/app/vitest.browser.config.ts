import { defineConfig, mergeConfig } from "vitest/config"
import { playwright } from "@vitest/browser-playwright"
import viteConfig from "./vite.config.ts"

// Real Chromium for tests that need layout. Headless and muted: nothing here may play audio.
export default mergeConfig(
  viteConfig,
  defineConfig({
    define: { __SHOT__: JSON.stringify(process.env.SHOT === "1") },
    server: { fs: { allow: [".", "/tmp/troubadour-shots"] } },
    test: {
      name: "browser",
      include: ["src/**/*.browser.test.{ts,tsx}"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { args: ["--mute-audio"] } }),
        instances: [{ browser: "chromium", viewport: { width: 1440, height: 900 } }],
      },
    },
  }),
)
