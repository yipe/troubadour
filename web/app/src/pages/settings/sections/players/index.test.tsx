import { fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CampaignJob } from "@troubadour/api/campaign"
import type { Clones } from "@troubadour/api/clones"
import type { DndClass } from "@troubadour/api/players"
import { keys } from "@troubadour/api/query"
import {
  campaign,
  campaignJob,
  cloneClip,
  cloneVoice,
  libraryPlayer,
  mockFetch,
  player,
  session,
  snapshotBase,
  speechProfile,
} from "@troubadour/api/testing"
import { renderWithProviders } from "../../../../test/render.tsx"
import { Component as PlayersSettings } from "./index.tsx"
import { VoiceCloneDialog } from "./VoiceCloneDialog.tsx"

afterEach(() => vi.restoreAllMocks())

const CLASSES: DndClass[] = [
  { id: "bard", label: "Bard", color: null, builtin: true },
  { id: "tinkerer", label: "Tinkerer", color: "#8c6040", builtin: false },
]
const EMPTY: Clones = { voices: {}, profiles: {}, clips: [], available: true }
const VOICE = cloneVoice({
  player_id: "p1",
  source: "recording of 2026-10-12",
  tried: [
    { source: "Train recording", likeness: 0.62 },
    { source: "recording of 2026-10-12", likeness: 0.812 },
  ],
  likeness: 0.812,
  preview_url: "/api/clones/p1/preview.wav?v=1",
  preview_text: "Okay so you know what, I check the door for traps?",
  preview_kind: "ai",
})

describe("Players & voices settings", () => {
  it("seats a benched player and deletes one for good after confirming", async () => {
    const { writes } = mockFetch(() => player({ id: "p9", name: "Rin" }))
    renderWithProviders(<PlayersSettings />, {
      live: {
        ...snapshotBase(),
        session: session(),
        players: [],
        library: [libraryPlayer({ id: "p9", name: "Rin" })],
      },
      queryData: [
        [keys.classes(), CLASSES],
        [keys.clones(), EMPTY],
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: "Seat Rin" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "POST", url: "/api/players/p9/seat" })

    fireEvent.click(screen.getByRole("button", { name: "Delete Rin for good" }))
    fireEvent.click(await screen.findByRole("button", { name: "Remove for good" }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[1]).toMatchObject({ method: "DELETE", url: "/api/players/p9" })
  })

  it("no longer shows Classes (they moved to Content)", () => {
    mockFetch(() => undefined)
    renderWithProviders(<PlayersSettings />, {
      live: { ...snapshotBase(), session: session(), players: [] },
      queryData: [
        [keys.classes(), CLASSES],
        [keys.clones(), EMPTY],
      ],
    })
    expect(screen.queryByRole("region", { name: "Classes" })).toBeNull()
    expect(screen.getAllByRole("heading", { name: "Players & voices" })).toHaveLength(1)
  })
})

/** A fake server: GET /api/clones answers the seeded clones; every write answers `write`. */
function serve(write: unknown, clones: Clones = EMPTY) {
  return mockFetch((c) => (c.method === "GET" && c.url === "/api/clones" ? clones : write))
}

function renderDialog(
  p: ReturnType<typeof player>,
  clones: Clones,
  opts: { status?: "idle" | "running"; jobs?: CampaignJob[] } = {},
) {
  return renderWithProviders(<VoiceCloneDialog playerId={p.id} open onOpenChange={() => {}} />, {
    live: { ...snapshotBase(), session: session({ status: opts.status ?? "idle" }), players: [p] },
    queryData: [
      [keys.clones(), clones],
      [keys.campaign(), campaign({ jobs: opts.jobs ?? [] })],
    ],
  })
}

describe("VoiceCloneDialog", () => {
  it("does nothing until the player agrees", async () => {
    const alice = player({ id: "p1", name: "Alice" })
    const { writes } = serve({ ...alice, clone_ok: true })
    renderDialog(alice, EMPTY)
    expect(screen.queryByRole("button", { name: /Build voice/ })).toBeNull()
    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "PATCH", url: "/api/players/p1", body: { clone_ok: true } })
  })

  it("asks for a Train recording before building", () => {
    serve(undefined)
    renderDialog(player({ id: "p1", name: "Alice", clone_ok: true }), EMPTY)
    expect(screen.getByText(/Train Alice first/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Build voice/ })).toBeNull()
  })

  it("off Apple Silicon, says why there's no voice and keeps the speech profile", () => {
    serve(undefined)
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    renderDialog(alice, { ...EMPTY, available: false })
    expect(screen.getByText(/Voice clones need a Mac with Apple Silicon/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Build voice/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Profile how they talk/ })).toBeInTheDocument()
  })

  it("builds the voice and shows the preview, likeness and what it says; nothing autoplays", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    const { writes } = serve(campaignJob({ id: "j1", kind: "clone", player_id: "p1" }))
    const first = renderDialog(alice, EMPTY)
    fireEvent.click(screen.getByRole("button", { name: /Build voice/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "POST", url: "/api/players/p1/clone" })
    first.unmount()

    renderDialog(alice, { ...EMPTY, voices: { p1: VOICE } })
    const audio = screen.getByLabelText("Preview: Their own voice")
    expect(audio).toHaveAttribute("src", VOICE.preview_url)
    expect(audio).toHaveAttribute("preload", "none")
    expect(audio).not.toHaveAttribute("autoplay")
    expect(screen.getByText("“Okay so you know what, I check the door for traps?”")).toBeInTheDocument()
    expect(screen.getByText(/Written in their style/)).toBeInTheDocument()
    expect(
      screen.getByText(/· likeness 0.81 · from the recording of 2026-10-12, best of 2/),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Rebuild voices/ })).toBeEnabled()
  })

  it("shows the running build and disables the button", () => {
    serve(undefined)
    renderDialog(player({ id: "p1", name: "Alice", trained: true, clone_ok: true }), EMPTY, {
      jobs: [
        campaignJob({
          id: "j1",
          kind: "clone",
          player_id: "p1",
          state: "running",
          done: 1,
          total: 3,
          message: "Trying the Train clip cleaned…",
        }),
      ],
    })
    expect(screen.getByText("Trying the Train clip cleaned…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Build voice/ })).toBeDisabled()
  })

  it("speaks typed text, lists the clip and deletes it", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    const { writes } = serve(campaignJob({ id: "s1", kind: "say", player_id: "p1" }))
    renderDialog(alice, {
      ...EMPTY,
      voices: { p1: VOICE },
      profiles: {},
      clips: [
        cloneClip({ id: "c1", player_id: "p1", title: "Roll for initiative!", url: "/api/clones/p1/c1.wav" }),
      ],
    })
    fireEvent.change(screen.getByLabelText("Something for Alice to say"), {
      target: { value: "  Roll for initiative!  " },
    })
    fireEvent.click(screen.getByRole("button", { name: /Speak/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      url: "/api/players/p1/clone/say",
      body: { text: "Roll for initiative!", in_their_words: false, persona: "table" },
    })
    await waitFor(() => expect(screen.getByLabelText("Something for Alice to say")).toHaveValue(""))

    fireEvent.click(screen.getByRole("button", { name: 'Delete "Roll for initiative!"' }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[1]).toMatchObject({ method: "DELETE", url: "/api/clones/p1/clips/c1" })
  })

  it("confirms before turning consent off, then patches clone_ok false", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    const { writes } = serve({ ...alice, clone_ok: false })
    renderDialog(alice, { ...EMPTY, voices: { p1: VOICE } })
    fireEvent.click(screen.getByRole("switch", { name: /agrees to a voice clone/ }))
    expect(
      await screen.findByText("Delete Alice's voice clone, speech profile and every clip made with them?"),
    ).toBeInTheDocument()
    expect(writes()).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Delete them" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ body: { clone_ok: false } })
  })

  it("profiles how they talk and shows the counts, pet phrases and description", async () => {
    const alice = player({ id: "p1", name: "Alice", clone_ok: true })
    const { writes } = serve(campaignJob({ id: "pr1", kind: "profile", player_id: "p1" }))
    const first = renderDialog(alice, EMPTY)
    fireEvent.click(screen.getByRole("button", { name: /Profile how they talk/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ url: "/api/players/p1/profile" })
    first.unmount()

    renderDialog(alice, {
      ...EMPTY,
      profiles: {
        p1: speechProfile({
          player_id: "p1",
          sessions: 2,
          lines: 40,
          wpm: 170,
          words_per_line: 9.2,
          questions: 0.75,
          in_character: 0.1,
          phrases: ["you know what"],
          openers: ["okay", "so"],
          description: "Quick and curious; asks before she acts.",
        }),
      },
    })
    expect(screen.getByText("Quick and curious; asks before she acts.")).toBeInTheDocument()
    expect(
      screen.getByText(
        "170 words a minute · 9.2 words a line · 75% questions · 0% exclamations · 10% in character",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("“you know what”")).toBeInTheDocument()
    expect(screen.getByText("Often starts with: okay, so")).toBeInTheDocument()
    expect(screen.getByText("From 40 lines in 2 sessions.")).toBeInTheDocument()
  })

  it("says it in their words only once they have a profile, and not in a character's voice", async () => {
    const alice = player({ id: "p1", name: "Alice", trained: true, clone_ok: true })
    const elara = cloneVoice({ player_id: "p1", persona: "elara", label: "Elara", preview_url: "/e.wav" })
    const { writes } = serve(campaignJob({ id: "s1", kind: "say", player_id: "p1" }))
    const first = renderDialog(alice, { ...EMPTY, voices: { p1: VOICE } })
    expect(screen.getByRole("switch", { name: /In their words/ })).toHaveAttribute("aria-disabled", "true")
    first.unmount()

    renderDialog(alice, {
      ...EMPTY,
      voices: { p1: { ...VOICE, characters: [elara] } },
      profiles: { p1: speechProfile({ player_id: "p1" }) },
    })
    expect(screen.getByLabelText("Preview: As Elara")).toHaveAttribute("src", "/e.wav")
    fireEvent.click(screen.getByRole("switch", { name: /In their words/ }))
    fireEvent.change(screen.getByLabelText("Something for Alice to say"), {
      target: { value: "I open the door." },
    })
    fireEvent.click(screen.getByRole("button", { name: /Speak/ }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]!.body).toEqual({ text: "I open the door.", in_their_words: true, persona: "table" })

    fireEvent.change(screen.getByRole("combobox", { name: "Voice" }), { target: { value: "elara" } })
    expect(screen.getByRole("switch", { name: /In their words/ })).toHaveAttribute("aria-disabled", "true")
  })

  it("holds off while a session runs", () => {
    serve(undefined)
    renderDialog(player({ id: "p1", name: "Alice", trained: true, clone_ok: true }), EMPTY, {
      status: "running",
    })
    const build = screen.getByRole("button", { name: /Build voice/ })
    expect(build).toBeDisabled()
    expect(build).toHaveAttribute("title", "Stop the session first")
  })
})
