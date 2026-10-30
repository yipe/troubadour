import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, expect, it } from "vitest"
import { makeQueryClient } from "@troubadour/api/query"
import { keys } from "@troubadour/api/query"
import {
  backupAttempt,
  cloudAccount,
  cloudBackup,
  cloudStatus,
  cloudVault,
  mockFetch,
} from "@troubadour/api/testing"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import "../../../../index.css"
import { shot } from "../../../../../test/shot.ts"
import { Component } from "./index.tsx"

let unmount = () => {}
afterEach(() => {
  unmount()
  document.body.innerHTML = ""
})

async function mount(status: ReturnType<typeof cloudStatus>) {
  const at = Date.now() / 1000
  mockFetch((c) => {
    if (c.url === "/api/cloud/history")
      return {
        attempts: [
          backupAttempt({ at: at - 240, changed: 14, message: "14 notes changed" }),
          backupAttempt({ at: at - 86400 * 8, ok: false, snapshot: null, error: "no connection" }),
          backupAttempt({ at: at - 86400 * 15, changed: 41 }),
        ],
      }
    if (c.url === "/api/cloud/vaults")
      return [cloudVault({ id: "v2", name: "Lantern Road", campaign_id: "lantern", head_snapshot: "s" })]
    if (c.url === "/api/cloud/account") return cloudAccount({ email: "alex@example.com" })
    return undefined
  })
  const client = makeQueryClient()
  client.setQueryData(keys.cloud(), status)
  const el = document.createElement("div")
  el.style.cssText = "width:1180px;height:900px"
  document.body.append(el)
  const root = createRoot(el)
  root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <Component />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  unmount = () => root.unmount()
  await new Promise((r) => setTimeout(r, 300))
  return el
}

it("renders the connected layout", async () => {
  const el = await mount(
    cloudStatus({
      connected: true,
      auto_backup: true,
      device: "Studio Mac",
      main_device: "Studio Mac",
      last_backup: cloudBackup({ at: Date.now() / 1000 - 240, files: 1212 }),
    }),
  )
  expect(el.textContent).toContain("What goes up")
  await shot("cloud-settings-connected")
})

it("renders a failed backup on another main Mac", async () => {
  const el = await mount(
    cloudStatus({
      connected: true,
      is_main: false,
      main_device: "Maya's MacBook",
      last_backup: cloudBackup({ at: Date.now() / 1000 - 86400 * 8 }),
      last_error: { at: Date.now() / 1000 - 60, message: "no connection" },
    }),
  )
  expect(el.textContent).toContain("Backup failed")
  await shot("cloud-settings-failed")
})
