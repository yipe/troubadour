import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { keys } from "@troubadour/api/query"
import {
  backupAttempt,
  bodyOf,
  campaignJob,
  cloudAccount,
  cloudBackup,
  cloudStatus,
  cloudVault,
  mockFetch,
} from "@troubadour/api/testing"
import { afterEach, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../../../test/render.tsx"
import { Component } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const NOW = Date.now() / 1000
const connected = cloudStatus({
  connected: true,
  campaign: "main",
  last_backup: cloudBackup({ at: NOW - 240, files: 1212 }),
})

function setup(status = connected, localCampaigns: string[] = ["main"]) {
  const m = mockFetch((call) => {
    switch (call.url) {
      case "/api/cloud/history":
        return {
          attempts: [
            backupAttempt({ at: NOW - 240, snapshot: "11111111-1111-1111-1111-111111111111", changed: 14 }),
            backupAttempt({ at: NOW - 86400 * 8, ok: false, snapshot: null, error: "no connection" }),
          ],
        }
      case "/api/cloud/vaults":
        return [
          cloudVault({ id: "v-main", campaign_id: "main", head_snapshot: "s" }),
          cloudVault({ id: "v-lantern", name: "Lantern Road", campaign_id: "lantern", head_snapshot: "s" }),
        ]
      case "/api/cloud/account":
        return cloudAccount({ email: "alex@example.com" })
      case "/api/cloud/restore":
        return campaignJob({ id: "r1", kind: "restore", state: "running" })
      case "/api/cloud/disconnect":
        return cloudStatus()
      case "/api/cloud/options":
        return { ...status, include_transcripts: true }
      default:
        return {}
    }
  })
  renderWithProviders(<Component />, {
    queryData: [
      [keys.cloud(), status],
      [
        keys.campaigns(),
        { campaign: "main", campaigns: localCampaigns.map((id) => ({ id, name: id, table_name: "" })) },
      ],
    ],
  })
  return m
}

it("offers Connect when not connected, without calling the service", () => {
  const m = setup(cloudStatus())
  fireEvent.click(screen.getByRole("button", { name: "Connect" }))
  expect(screen.getByText("Goes up")).toBeInTheDocument()
  expect(m.writes()).toEqual([])
})

it("shows successful and failed attempts, and only successes can be restored", async () => {
  setup()
  expect(await screen.findByText("14 notes changed")).toBeInTheDocument()
  expect(screen.getByText("Failed: no connection")).toBeInTheDocument()
  expect(screen.getByText("Backed up 4 min ago")).toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: "Restore…" })).toHaveLength(1)
})

it("restores the chosen snapshot of this campaign", async () => {
  const m = setup()
  fireEvent.click(await screen.findByRole("button", { name: "Restore…" }))
  await waitFor(() => expect(m.calls.some((c) => c.url === "/api/cloud/vaults")).toBe(true))
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }))
  await waitFor(() =>
    expect(bodyOf(m.writes().at(-1)!)).toEqual({
      vault_id: "v-main",
      snapshot: "11111111-1111-1111-1111-111111111111",
    }),
  )
})

it("brings another campaign to this Mac after confirming", async () => {
  const m = setup()
  expect(await screen.findByText("Lantern Road")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Bring to this Mac" }))
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Bring to this Mac" }),
  )
  await waitFor(() => expect(bodyOf(m.writes().at(-1)!)).toEqual({ vault_id: "v-lantern" }))
})

it("never offers to bring a campaign this Mac already has", async () => {
  setup(connected, ["main", "lantern"])
  expect(await screen.findByText("Lantern Road")).toBeInTheDocument()
  expect(screen.getByText("On this Mac")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Bring to this Mac" })).toBeNull()
})

it("asks before disconnecting", async () => {
  const m = setup()
  expect(await screen.findByText("Signed in as alex@example.com")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
  expect(m.writes()).toEqual([])
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }))
  await waitFor(() => expect(m.writes()).toMatchObject([{ method: "POST", url: "/api/cloud/disconnect" }]))
})

it("saves the transcripts option from the switch", async () => {
  const m = setup()
  fireEvent.click(screen.getByRole("switch", { name: "Transcripts" }))
  await waitFor(() => expect(bodyOf(m.writes()[0]!)).toEqual({ include_transcripts: true }))
})
