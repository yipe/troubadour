import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
// A relative path, not the package name: the config is bundled, and Node won't strip types in node_modules.
import { THEME_BOOT_SCRIPT } from "../packages/ui/src/lib/theme-choice.ts"

const port = process.env.TROUBADOUR_PORT ?? "8765"
const http = `http://127.0.0.1:${port}`

/** Themes the page before the first paint, with the same script the cloud website uses. */
const themeBoot: Plugin = {
  name: "troubadour-theme-boot",
  transformIndexHtml: () => [{ tag: "script", children: THEME_BOOT_SCRIPT, injectTo: "head" }],
}

export default defineConfig({
  plugins: [react(), tailwindcss(), themeBoot],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // The backend serves web/dist.
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: {
    proxy: {
      "/api": http,
      "/auth": http,
      "/ws": { target: `ws://127.0.0.1:${port}`, ws: true },
    },
  },
})
