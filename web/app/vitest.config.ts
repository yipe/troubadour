import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config.ts"

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: "app",
      environment: "jsdom",
      setupFiles: ["./test/setup.ts", "./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      exclude: ["src/**/*.browser.test.{ts,tsx}"],
    },
  }),
)
