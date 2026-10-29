import { act, fireEvent, render, screen } from "@testing-library/react"
import { VirtuosoMockContext } from "react-virtuoso"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionViewer } from "@/components/history/SessionViewer"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCampaign } from "@/lib/campaignStore"
import { useClones } from "@/lib/cloneStore"
import { applyEvent, useStore } from "@/lib/store"
import type { Campaign, Clones } from "@/lib/types"
import { campaign, campaignJob, player, savedSession, sessionRecord } from "@/test/fixtures"
import { bodyOf, mockFetch } from "@/test/mockFetch"

const ID = "2026-10-08_193401-eebf"
const initial = useCampaign.getState()
const initialStore = useStore.getState()

function server(c: Campaign, clones?: { current: Clones }) {
  return mockFetch((call) => {
    if (call.url === "/api/campaign") return c
    if (call.url === `/api/sessions/${ID}/transcript.json`) return sessionRecord({ id: ID })
    if (call.url === `/api/campaign/writeup/${ID}`)
      return campaignJob({ id: "w1", kind: "writeup", title: ID })
    if (clones && call.url === "/api/clones") return clones.current
    if (clones && call.url === "/api/players/p1/clone/read")
      return campaignJob({ id: "r1", kind: "read", title: ID, player_id: "p1" })
    return new Response(null, { status: 500 })
  })
}

async function renderViewer() {
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 60 }}>
      <TooltipProvider>
        <SessionViewer summary={savedSession({ id: ID })} onBack={() => {}} />
      </TooltipProvider>
    </VirtuosoMockContext.Provider>,
  )
  await act(async () => {})
  fireEvent.click(screen.getByRole("button", { name: "Write-up" }))
  await act(async () => {}) // the tab loads the campaign on mount
}

beforeEach(() => {
  useCampaign.setState(initial, true)
  useStore.setState(initialStore, true)
  useClones.setState({ clones: null })
})
afterEach(() => vi.restoreAllMocks())

describe("History viewer: write up for campaign", () => {
  it("posts the write-up and shows its progress until the job ends", async () => {
    const { writes } = server(campaign())
    await renderViewer()
    const button = screen.getByRole("button", { name: /Write up for campaign/ })
    expect(screen.queryByRole("link", { name: /Session page/ })).toBeNull()

    fireEvent.click(button)
    await act(async () => {})
    expect(writes()).toEqual([{ method: "POST", url: `/api/campaign/writeup/${ID}`, body: undefined }])
    expect(screen.getByRole("button", { name: /Write up for campaign/ })).toBeDisabled()

    act(() =>
      applyEvent({
        type: "campaign.job",
        data: campaignJob({ id: "w1", kind: "writeup", title: ID, state: "running", done: 2, total: 5 }),
      }),
    )
    expect(screen.getByRole("button", { name: /Write up for campaign/ })).toHaveTextContent("2/5")

    // A different session's write-up doesn't affect this button.
    act(() =>
      applyEvent({
        type: "campaign.job",
        data: campaignJob({ id: "w2", kind: "writeup", title: "other", state: "running" }),
      }),
    )
    act(() =>
      applyEvent({
        type: "campaign.job",
        data: campaignJob({ id: "w1", kind: "writeup", title: ID, state: "done" }),
      }),
    )
    expect(screen.getByRole("button", { name: /Write up for campaign/ })).toBeEnabled()
  })

  it("offers 'Write up again' and a session-page link once written up", async () => {
    const page = "Sessions/2026-10-08 The Desert Road.md"
    server(campaign({ obsidian: { id: "543fe3e0024d1d47", folder: "" }, written_up: { [ID]: page } }))
    await renderViewer()
    expect(screen.getByRole("button", { name: /Write up again/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Session page/ })).toHaveAttribute(
      "href",
      `obsidian://open?vault=543fe3e0024d1d47&file=${encodeURIComponent(page)}`,
    )
  })

  it("explains instead of linking when Obsidian doesn't know the campaign folder", async () => {
    server(campaign({ vault: "/V", obsidian: null, written_up: { [ID]: "Sessions/x.md" } }))
    await renderViewer()
    expect(screen.queryByRole("link", { name: /Session page/ })).toBeNull()
    const hint = screen.getByText(/open the folder in Obsidian first/)
    expect(hint).toHaveAttribute("title", expect.stringContaining("Open folder as vault → /V"))
  })

  it("reads the session page aloud in a player's cloned voice", async () => {
    const page = "Sessions/2026-10-08 The Desert Road.md"
    useStore.setState({
      players: [player({ id: "p1", name: "Alice", clone_ok: true }), player({ id: "p2", name: "Bob" })],
    })
    const voice = {
      player_id: "p1",
      built_at: 1,
      likeness: 0.8,
      reference_s: 10,
      preview_url: "/x",
      clone_wpm: 150,
    }
    const clones = { current: { voices: { p1: voice }, profiles: {}, clips: [] } as Clones }
    const { writes } = server(campaign({ written_up: { [ID]: page } }), clones)
    await renderViewer()
    expect(screen.getByRole("combobox", { name: "Read by" })).toHaveDisplayValue("Alice") // Bob has no voice

    fireEvent.click(screen.getByRole("button", { name: /Read aloud/ }))
    await act(async () => {})
    expect(writes().map((c) => c.url)).toEqual(["/api/players/p1/clone/read"])
    expect(bodyOf(writes()[0])).toEqual({ session: ID, in_their_words: false })
    act(() =>
      applyEvent({
        type: "campaign.job",
        data: campaignJob({
          id: "r1",
          kind: "read",
          title: ID,
          player_id: "p1",
          state: "running",
          done: 3,
          total: 9,
        }),
      }),
    )
    expect(screen.getByRole("button", { name: /Read aloud/ })).toHaveTextContent("3/9")

    const clip = {
      id: "c1",
      player_id: "p1",
      kind: "read" as const,
      title: "2026-10-08 The Desert Road",
      text: "",
      source: { session: ID, note: page },
      in_their_words: false,
      seconds: 80,
      created_at: 1,
      url: "/api/clones/p1/c1.wav",
    }
    clones.current = { voices: { p1: voice }, profiles: {}, clips: [clip] }
    act(() =>
      applyEvent({
        type: "campaign.job",
        data: campaignJob({ id: "r1", kind: "read", title: ID, state: "done" }),
      }),
    )
    await act(async () => {})
    expect(screen.getByLabelText("Read aloud")).toHaveAttribute("src", clip.url)
    expect(screen.getByLabelText("Read aloud")).toHaveAttribute("preload", "none")
    expect(screen.getByText("Read by Alice")).toBeInTheDocument()
  })

  it("reads it in their words when the reader has a speech profile", async () => {
    useStore.setState({ players: [player({ id: "p1", name: "Alice", clone_ok: true })] })
    const voice = {
      player_id: "p1",
      built_at: 1,
      likeness: 0.8,
      reference_s: 10,
      preview_url: "/x",
      clone_wpm: 150,
    }
    const profile = {
      player_id: "p1",
      built_at: 1,
      sessions: 1,
      lines: 40,
      words: 400,
      wpm: 160,
      words_per_line: 10,
      questions: 0.2,
      exclamations: 0.1,
      in_character: 0.3,
      phrases: [],
      openers: [],
      examples: [],
      description: null,
    }
    const clones = { current: { voices: { p1: voice }, profiles: { p1: profile }, clips: [] } as Clones }
    const { writes } = server(campaign({ written_up: { [ID]: "Sessions/x.md" } }), clones)
    await renderViewer()
    fireEvent.click(screen.getByRole("switch", { name: /In their words/ }))
    fireEvent.click(screen.getByRole("button", { name: /Read aloud/ }))
    await act(async () => {})
    expect(bodyOf(writes()[0])).toEqual({ session: ID, in_their_words: true })
  })

  it("points to Setup when nobody has a voice clone yet", async () => {
    server(campaign({ written_up: { [ID]: "Sessions/x.md" } }), {
      current: { voices: {}, profiles: {}, clips: [] },
    })
    await renderViewer()
    expect(screen.getByText(/Build a player's voice clone in Setup/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Read aloud/ })).toBeNull()
  })
})
