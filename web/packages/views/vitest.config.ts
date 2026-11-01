import { defineConfig } from "vitest/config"

export default defineConfig({ test: { name: "views", environment: "jsdom" } })
