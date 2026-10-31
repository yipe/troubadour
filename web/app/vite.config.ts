import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const port = process.env.TROUBADOUR_PORT ?? "8765"
const http = `http://127.0.0.1:${port}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
