import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCampaign } from "@/lib/campaignStore"
import { useClones } from "@/lib/cloneStore"
import { applyEvent, useStore } from "@/lib/store"
import type { CampaignJob, CloneClip, Clones, Player } from "@/lib/types"
import { campaignJob, player, session, snapshotBase } from "@/test/fixtures"
import { bodyOf, mockFetch } from "@/test/mockFetch"
import { PlayerCard } from "./PlayerCard"

const initialStore = useStore.getState()
const initialCampaign = useCampaign.getState()

const VOICE = {
  player_id: "p1",
  built_at: 1,
  cleaned: true,
  likeness: 0.812,
  reference_s: 10.4,
  preview_url: "/api/clones/p1/preview.wav?v=1",
}
const CLIP: CloneClip = {
  id: "c1",
  player_id: "p1",
  kind: "say",
  title: "Roll for initiative!",
  text: "Roll for initiative!",
  source: {},
  seconds: 1.6,
  created_at: 2,
  url: "/api/clones/p1/c1.wav",
}

function load(p: Player, status: "idle" | "running" = "idle") {
  applyEvent({
    type: "snapshot",
    data: { ...snapshotBase(), session: session({ status }), players: [p], voices: [], messages: [] },
  })
}

/** A fake server: `state.clones` is what GET /api/clones answers; writes answer `write(call)`. */
function server(state: { clones: Clones }, write: (url: string) => unknown = () => undefined) {
  return mockFetch((c) => {
    if (c.method === "GET" && c.url === "/api/clones") return state.clones
    if (c.method !== "GET") return write(c.url)
    return new Response(null, { status: 500 })
  })
}

async function open(p: Player) {
  render(
    <TooltipProvider>
      <PlayerCard player={p} />
    </TooltipProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Voice clone" }))
  await act(async () => {})
}

const job = (j: Partial<CampaignJob> & { id: string }) =>
  act(() => applyEvent({ type: "campaign.job", data: campaignJob(j) }))

beforeEach(() => {
  useStore.setState(initialStore, true)
  useCampaign.setState(initialCampaign, true)
  useClones.setState({ clones: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  toast.dismiss()
})

describe("Voice clone dialog", () => {
  it("does nothing until the player agrees", async () => {
    const alice = player({ id: "p1", name: "Alice" })
    load(alice)
    const { writes } = server({ clones: { voices: {}, clips: [] } }, () => ({ ...alice, clone_ok: true }))
    await open(alice)
    expect(screen.queryByRole("button", { name: /Build voice/ })).toBeNull()

    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    await waitFor(() =>
      expect(writes().map((c) => [c.method, c.url])).toEqual([["PATCH", "/api/players/p1"]]),
    )
    expect(bodyOf(writes()[0])).toEqual({ clone_ok: true })
    expect(useStore.getState().players[0].clone_ok).toBe(true)
  })

  it("asks for a Train recording before building", async () => {
    const alice = player({ id: "p1", name: "Alice", clone_ok: true })
    load(alice)
    server({ clones: { voices: {}, clips: [] } })
    await open(alice)
    expect(screen.getByText(/Train Alice first/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Build voice/ })).toBeNull()
  })

  it("builds the voice, shows the job, then the preview and the likeness", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const state: { clones: Clones } = { clones: { voices: {}, clips: [] } }
    const { writes } = server(state, () =>
      campaignJob({ id: "j1", kind: "clone", title: "Alice", player_id: "p1" }),
    )
    await open(alice)

    fireEvent.click(screen.getByRole("button", { name: /Build voice/ }))
    await waitFor(() =>
      expect(writes().map((c) => [c.method, c.url])).toEqual([["POST", "/api/players/p1/clone"]]),
    )
    job({
      id: "j1",
      kind: "clone",
      title: "Alice",
      player_id: "p1",
      state: "running",
      done: 1,
      total: 3,
      message: "Trying the Train clip cleaned…",
    })
    expect(screen.getByText(/Trying the Train clip cleaned… 1\/3/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Build voice/ })).toBeDisabled()

    state.clones = { voices: { p1: VOICE }, clips: [] }
    job({ id: "j1", kind: "clone", title: "Alice", player_id: "p1", state: "done" })
    await waitFor(() => expect(screen.getByLabelText("Preview")).toHaveAttribute("src", VOICE.preview_url))
    expect(screen.getByLabelText("Preview")).toHaveAttribute("preload", "none") // never autoplays
    expect(screen.getByText("Likeness 0.81")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Rebuild voice/ })).toBeEnabled()
  })

  it("speaks typed text and lists the clip, which can be deleted", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const state: { clones: Clones } = { clones: { voices: { p1: VOICE }, clips: [] } }
    const { writes } = server(state, (url) =>
      url.endsWith("/clone/say")
        ? campaignJob({ id: "s1", kind: "say", title: "Alice", player_id: "p1" })
        : undefined,
    )
    await open(alice)

    fireEvent.change(screen.getByLabelText("Something for Alice to say"), {
      target: { value: "  Roll for initiative!  " },
    })
    fireEvent.click(screen.getByRole("button", { name: /Speak/ }))
    await waitFor(() => expect(writes().map((c) => c.url)).toEqual(["/api/players/p1/clone/say"]))
    expect(bodyOf(writes()[0])).toEqual({ text: "Roll for initiative!" })
    await waitFor(() => expect(screen.getByLabelText("Something for Alice to say")).toHaveValue(""))

    state.clones = { voices: { p1: VOICE }, clips: [CLIP] }
    job({ id: "s1", kind: "say", title: "Alice", player_id: "p1", state: "done" })
    await waitFor(() => expect(screen.getByText("Roll for initiative!")).toBeInTheDocument())

    state.clones = { voices: { p1: VOICE }, clips: [] }
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Roll for initiative!"' }))
    await waitFor(() => expect(screen.queryByText("Roll for initiative!")).toBeNull())
    expect(writes().at(-1)).toMatchObject({ method: "DELETE", url: "/api/clones/p1/clips/c1" })
  })

  it("confirms before turning it off deletes the voice", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const { writes } = server({ clones: { voices: { p1: VOICE }, clips: [] } }, () => ({
      ...alice,
      clone_ok: false,
    }))
    await open(alice)
    await waitFor(() => expect(screen.getByLabelText("Preview")).toBeInTheDocument())

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    expect(confirm).toHaveBeenCalledWith("Delete Alice's voice clone and every clip made with it?")
    expect(writes()).toEqual([])

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    await waitFor(() => expect(writes().map((c) => c.body)).toEqual([{ clone_ok: false }]))
  })

  it("holds off while a session runs", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice, "running")
    server({ clones: { voices: {}, clips: [] } })
    await open(alice)
    const build = screen.getByRole("button", { name: /Build voice/ })
    expect(build).toBeDisabled()
    expect(build).toHaveAttribute("title", "Stop the session first")
  })
})
