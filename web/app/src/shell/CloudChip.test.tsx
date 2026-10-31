import { fireEvent, screen, waitFor } from "@testing-library/react"
import { keys } from "@troubadour/api/query"
import {
  backupAttempt,
  bodyOf,
  campaignJob,
  cloudBackup,
  cloudStatus,
  cloudVault,
  mockFetch,
} from "@troubadour/api/testing"
import { afterEach, expect, it, vi } from "vitest"
import { renderWithProviders } from "../test/render.tsx"
import { CloudChip } from "./CloudChip.tsx"

afterEach(() => vi.restoreAllMocks())

const connected = (extra = {}) =>
  cloudStatus({
    connected: true,
    last_backup: cloudBackup({ at: Date.now() / 1000 - 240, files: 1212 }),
    ...extra,
  })

function setup(
  status: ReturnType<typeof cloudStatus>,
  handler: Parameters<typeof mockFetch>[0] = () => ({}),
) {
  const m = mockFetch((call) => {
    if (call.url === "/api/cloud") return status
    if (call.url === "/api/cloud/history") return { attempts: [backupAttempt({ changed: 14 })] }
    return handler(call)
  })
  renderWithProviders(<CloudChip />, { queryData: [[keys.cloud(), status]] })
  return m
}

it("opens the first-connect dialog when not connected, without calling the service", () => {
  const m = setup(cloudStatus())
  fireEvent.click(screen.getByRole("button", { name: "Cloud backup" }))
  expect(screen.getByText("Goes up")).toBeInTheDocument()
  expect(screen.getByText("Stays on this Mac")).toBeInTheDocument()
  expect(m.writes()).toEqual([])
})

it("saves the transcripts option before signing in", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({ location: { href: "" } } as unknown as Window)
  const m = setup(cloudStatus(), (call) =>
    call.url === "/api/cloud/connect" ? { authorize_url: "http://signin.invalid" } : cloudStatus(),
  )
  fireEvent.click(screen.getByRole("button", { name: "Cloud backup" }))
  fireEvent.click(screen.getByRole("switch", { name: "Also transcripts" }))
  fireEvent.click(screen.getByRole("button", { name: /Connect/ }))
  await waitFor(() =>
    expect(m.writes().map((c) => c.url)).toEqual(["/api/cloud/options", "/api/cloud/connect"]),
  )
  expect(bodyOf(m.writes()[0]!)).toEqual({ include_transcripts: true })
  expect(open).toHaveBeenCalled()
})

it("shows the backup age on the chip and 'Back up now' calls the endpoint", async () => {
  const m = setup(connected(), (call) =>
    call.url === "/api/cloud/backup" ? campaignJob({ id: "b1", kind: "backup", state: "running" }) : {},
  )
  fireEvent.click(screen.getByRole("button", { name: "Backed up 4 min ago" }))
  expect(await screen.findByText("Troubadour Cloud")).toBeInTheDocument()
  expect(screen.getByText(/This Mac is the main copy/)).toBeInTheDocument()
  expect(await screen.findByText(/1,212 files · 14 changed/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Back up now" }))
  await waitFor(() => expect(m.writes()).toMatchObject([{ method: "POST", url: "/api/cloud/backup" }]))
})

it("says another Mac is newest when this one is not the main copy", async () => {
  setup(connected({ is_main: false, main_device: "Studio Mac" }))
  fireEvent.click(screen.getByRole("button", { name: /Backed up/ }))
  expect(await screen.findByText("Studio Mac backed up last; newest backup wins")).toBeInTheDocument()
})

it("shows 'Paused during session' while a session is live", () => {
  const status = connected({ paused_live: true })
  mockFetch((call) => (call.url === "/api/cloud/history" ? { attempts: [] } : status))
  renderWithProviders(<CloudChip />, {
    queryData: [[keys.cloud(), status]],
    live: { session: { status: "running" } as never },
  })
  expect(screen.getByRole("button", { name: "Paused during session" })).toBeInTheDocument()
})

it("restores the newest backup of this campaign after confirming", async () => {
  const m = setup(connected(), (call) => {
    if (call.url === "/api/cloud/vaults")
      return [cloudVault({ id: "v9", campaign_id: "main", head_snapshot: "snap-9" })]
    if (call.url === "/api/cloud/restore") return campaignJob({ id: "r1", kind: "restore", state: "running" })
    return {}
  })
  fireEvent.click(screen.getByRole("button", { name: /Backed up/ }))
  fireEvent.click(await screen.findByRole("button", { name: "Restore…" }))
  expect(await screen.findByText(/go to \.trash/)).toBeInTheDocument()
  await waitFor(() => expect(m.calls.some((c) => c.url === "/api/cloud/vaults")).toBe(true))
  fireEvent.click(screen.getByRole("button", { name: "Restore" }))
  await waitFor(() => expect(bodyOf(m.writes().at(-1)!)).toEqual({ vault_id: "v9", snapshot: "snap-9" }))
})
