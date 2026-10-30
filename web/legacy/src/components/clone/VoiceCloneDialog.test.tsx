import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCampaign } from "@/lib/campaignStore"
import { useClones } from "@/lib/cloneStore"
import { applyEvent, useStore } from "@/lib/store"
import type { CampaignJob, CloneClip, Clones, Player, SpeechProfile } from "@/lib/types"
import { campaignJob, player, session, snapshotBase } from "@/test/fixtures"
import { bodyOf, mockFetch } from "@/test/mockFetch"
import { PlayerCard } from "@/components/setup/PlayerCard"

const initialStore = useStore.getState()
const initialCampaign = useCampaign.getState()

const VOICE = {
  player_id: "p1",
  built_at: 1,
  source: "recording of 2026-10-12",
  tried: [
    { source: "Train recording", likeness: 0.62 },
    { source: "recording of 2026-10-12", likeness: 0.812 },
  ],
  likeness: 0.812,
  reference_s: 10.4,
  preview_url: "/api/clones/p1/preview.wav?v=1",
  clone_wpm: 150,
  preview_text: "Okay so you know what, I check the door for traps?",
  preview_kind: "ai" as const,
}
const PROFILE: SpeechProfile = {
  player_id: "p1",
  built_at: 1,
  sessions: 2,
  lines: 40,
  words: 370,
  wpm: 170,
  words_per_line: 9.2,
  questions: 0.75,
  exclamations: 0,
  in_character: 0.1,
  phrases: ["you know what"],
  openers: ["okay", "so"],
  examples: [],
  description: "Quick and curious; asks before she acts.",
}
const CLIP: CloneClip = {
  id: "c1",
  player_id: "p1",
  kind: "say",
  title: "Roll for initiative!",
  text: "Roll for initiative!",
  source: {},
  in_their_words: false,
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
    const { writes } = server({ clones: { voices: {}, profiles: {}, clips: [] } }, () => ({
      ...alice,
      clone_ok: true,
    }))
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
    server({ clones: { voices: {}, profiles: {}, clips: [] } })
    await open(alice)
    expect(screen.getByText(/Train Alice first/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Build voice/ })).toBeNull()
  })

  it("builds the voice, shows the job, then the preview and the likeness", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const state: { clones: Clones } = { clones: { voices: {}, profiles: {}, clips: [] } }
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

    state.clones = { voices: { p1: VOICE }, profiles: {}, clips: [] }
    job({ id: "j1", kind: "clone", title: "Alice", player_id: "p1", state: "done" })
    await waitFor(() =>
      expect(screen.getByLabelText("Preview: Their own voice")).toHaveAttribute("src", VOICE.preview_url),
    )
    expect(screen.getByLabelText("Preview: Their own voice")).toHaveAttribute("preload", "none") // never autoplays
    expect(screen.getByText("“Okay so you know what, I check the door for traps?”")).toBeInTheDocument()
    expect(screen.getByText(/Written in their style/)).toBeInTheDocument()
    expect(
      screen.getByText(/· likeness 0.81 · from the recording of 2026-10-12, best of 2/),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Rebuild voice/ })).toBeEnabled()
  })

  it("speaks typed text and lists the clip, which can be deleted", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const state: { clones: Clones } = { clones: { voices: { p1: VOICE }, profiles: {}, clips: [] } }
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
    expect(bodyOf(writes()[0])).toEqual({
      text: "Roll for initiative!",
      in_their_words: false,
      persona: "table",
    })
    await waitFor(() => expect(screen.getByLabelText("Something for Alice to say")).toHaveValue(""))

    state.clones = { voices: { p1: VOICE }, profiles: {}, clips: [CLIP] }
    job({ id: "s1", kind: "say", title: "Alice", player_id: "p1", state: "done" })
    await waitFor(() => expect(screen.getByText("Roll for initiative!")).toBeInTheDocument())

    state.clones = { voices: { p1: VOICE }, profiles: {}, clips: [] }
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Roll for initiative!"' }))
    await waitFor(() => expect(screen.queryByText("Roll for initiative!")).toBeNull())
    expect(writes().at(-1)).toMatchObject({ method: "DELETE", url: "/api/clones/p1/clips/c1" })
  })

  it("confirms before turning it off deletes the voice", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const { writes } = server({ clones: { voices: { p1: VOICE }, profiles: {}, clips: [] } }, () => ({
      ...alice,
      clone_ok: false,
    }))
    await open(alice)
    await waitFor(() => expect(screen.getByLabelText("Preview: Their own voice")).toBeInTheDocument())

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    expect(confirm).toHaveBeenCalledWith(
      "Delete Alice's voice clone, speech profile and every clip made with them?",
    )
    expect(writes()).toEqual([])

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    await waitFor(() => expect(writes().map((c) => c.body)).toEqual([{ clone_ok: false }]))
  })

  it("profiles how they talk and shows the counts, pet phrases and the AI's description", async () => {
    const alice = player({ id: "p1", name: "Alice", clone_ok: true })
    load(alice)
    const state: { clones: Clones } = { clones: { voices: {}, profiles: {}, clips: [] } }
    const { writes } = server(state, () =>
      campaignJob({ id: "pr1", kind: "profile", title: "Alice", player_id: "p1" }),
    )
    await open(alice)
    fireEvent.click(screen.getByRole("button", { name: /Profile how they talk/ }))
    await waitFor(() => expect(writes().map((c) => c.url)).toEqual(["/api/players/p1/profile"]))
    job({
      id: "pr1",
      kind: "profile",
      title: "Alice",
      player_id: "p1",
      state: "running",
      message: "Describing how they talk…",
    })
    expect(screen.getByText(/Describing how they talk…/)).toBeInTheDocument()

    state.clones = { voices: {}, profiles: { p1: PROFILE }, clips: [] }
    job({ id: "pr1", kind: "profile", title: "Alice", player_id: "p1", state: "done" })
    await waitFor(() => expect(screen.getByText(PROFILE.description!)).toBeInTheDocument())
    expect(
      screen.getByText(
        "170 words a minute · 9.2 words a line · 75% questions · 0% exclamations · 10% in character",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("“you know what”")).toBeInTheDocument()
    expect(screen.getByText("Often starts with: okay, so")).toBeInTheDocument()
    expect(screen.getByText("From 40 lines in 2 sessions.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Update profile/ })).toBeEnabled()
  })

  it("says it in their words only once they have a profile", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const state: { clones: Clones } = { clones: { voices: { p1: VOICE }, profiles: {}, clips: [] } }
    const { writes } = server(state, () =>
      campaignJob({ id: "s1", kind: "say", title: "Alice", player_id: "p1" }),
    )
    await open(alice)
    expect(screen.getByRole("switch", { name: /In their words/ })).toHaveAttribute("aria-disabled", "true")

    state.clones = { voices: { p1: VOICE }, profiles: { p1: PROFILE }, clips: [] }
    act(() => useClones.setState({ clones: state.clones }))
    fireEvent.click(screen.getByRole("switch", { name: /In their words/ }))
    fireEvent.change(screen.getByLabelText("Something for Alice to say"), {
      target: { value: "I open the door." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Speak/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(bodyOf(writes()[0])).toEqual({ text: "I open the door.", in_their_words: true, persona: "table" })
  })

  it("shows each character voice and can speak in one", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice)
    const elara = {
      ...VOICE,
      persona: "elara",
      label: "Elara",
      likeness: 0.66,
      preview_url: "/api/clones/p1/preview_elara.wav?v=2",
      preview_text: "Hold, traveller.",
      preview_kind: "their lines" as const,
    }
    const state: { clones: Clones } = {
      clones: { voices: { p1: { ...VOICE, characters: [elara] } }, profiles: { p1: PROFILE }, clips: [] },
    }
    const { writes } = server(state, () =>
      campaignJob({ id: "s1", kind: "say", title: "Alice", player_id: "p1" }),
    )
    await open(alice)
    expect(screen.getByLabelText("Preview: As Elara")).toHaveAttribute("src", elara.preview_url)
    expect(screen.getByText("“Hold, traveller.”")).toBeInTheDocument()

    fireEvent.change(screen.getByRole("combobox", { name: "Voice" }), { target: { value: "elara" } })
    // In their words is their table talk's style: not for a character's voice.
    expect(screen.getByRole("switch", { name: /In their words/ })).toHaveAttribute("aria-disabled", "true")
    fireEvent.change(screen.getByLabelText("Something for Alice to say"), {
      target: { value: "Hold, traveller." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Speak/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(bodyOf(writes()[0])).toEqual({ text: "Hold, traveller.", in_their_words: false, persona: "elara" })
  })

  it("holds off while a session runs", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    load(alice, "running")
    server({ clones: { voices: {}, profiles: {}, clips: [] } })
    await open(alice)
    const build = screen.getByRole("button", { name: /Build voice/ })
    expect(build).toBeDisabled()
    expect(build).toHaveAttribute("title", "Stop the session first")
  })
})
