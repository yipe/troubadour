import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  bodyOf,
  mic,
  mockFetch,
  player,
  savedSession,
  session,
  type FetchCall,
} from "@troubadour/api/testing"
import { renderWithProviders, type RenderOptions } from "../../test/render.tsx"
import { Component as ReadyPage } from "./index.tsx"
import { SOURCES_POLL_MS } from "./polling.ts"
import { MIC_KEY, OLD_MIC_KEY } from "./savedMic.ts"

const JABRA = mic({
  name: "Jabra Speak 710",
  default: true,
  checks: [{ id: "around", label: "Picks up voices all around", ok: true, detail: "Omnidirectional" }],
})
const YETI = mic({
  name: "Yeti GX",
  checks: [{ id: "around", label: "Picks up voices all around", ok: false, detail: "Cardioid" }],
})
const LAST = savedSession({
  id: "s2",
  n: 2,
  started_at: 1_760_700_000,
  summary: "The party reached the abbey at low tide.",
})
const FIRST = savedSession({ id: "s1", n: 1, started_at: 1_760_000_000 })
const PLAYERS = [
  player({ id: "gm", name: "Alex", character: "", is_gm: true, trained: true }),
  player({ id: "p1", name: "Sam", character: "Pip", trained: true }),
  player({ id: "p2", name: "Jo", character: "Thessaly" }),
]

type Call = FetchCall

function server(extra: (c: Call) => unknown = () => undefined) {
  return mockFetch((c) => {
    const out = extra(c)
    if (out !== undefined) return out
    if (c.url === "/api/mics") return [JABRA, YETI]
    if (c.url === "/api/sessions") return [LAST, FIRST]
    if (c.url === "/api/sources")
      return { files: [{ name: "table.wav", duration: 90, audio_url: "/f" }], mics: [] }
    if (c.url === "/api/classes") return []
    if (c.url === "/api/clones") return { voices: {}, profiles: {}, clips: [] }
    if (c.url === "/api/session/start") return session({ status: "running" })
    return undefined
  })
}

function page(over: { live?: RenderOptions["live"]; route?: string } = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/sessions/new" element={<ReadyPage />} />
      <Route path="/sessions/live" element={<div>The live page</div>} />
    </Routes>,
    {
      route: over.route ?? "/sessions/new",
      live: {
        session: session({ status: "idle" }),
        players: PLAYERS,
        ...over.live,
      },
    },
  )
}

const startButton = () => screen.getByRole("button", { name: /Start session/ })
const consent = () => screen.getByRole("checkbox", { name: /Everyone here knows/ })
const startCalls = (writes: Call[]) => writes.filter((w) => w.url === "/api/session/start")

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("ReadyPage", () => {
  it("numbers the session, shows who is here, and keeps Start off until the consent is ticked", async () => {
    server()
    page()
    expect(await screen.findByText("Session 3 · ready check")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Session 3 (the write-up names it)")).toBeInTheDocument()
    expect(screen.getByText("3 of 3 · tap to toggle")).toBeInTheDocument()
    expect(startButton()).toBeDisabled()
    fireEvent.click(consent())
    expect(startButton()).toBeEnabled()
  })

  it("starts with the mic, the title and the options, and goes to the live page", async () => {
    const { writes } = server()
    page()
    await screen.findByRole("option", { name: "Jabra Speak 710 (default)" })
    fireEvent.change(screen.getByLabelText("Working title"), { target: { value: " The Abbey " } })
    fireEvent.click(consent())
    fireEvent.click(startButton())
    expect(await screen.findByText("The live page")).toBeInTheDocument()
    const [call] = startCalls(writes())
    expect(bodyOf(call!)).toEqual({
      source: { kind: "mic", device: null },
      title: "The Abbey",
      present_player_ids: ["gm", "p1", "p2"],
      record_audio: true,
      cleanup: true,
    })
  })

  it("leaves absent players out of present_player_ids", async () => {
    const { writes } = server()
    page()
    fireEvent.click(await screen.findByRole("button", { name: /Jo/ }))
    expect(screen.getByText("2 of 3 · tap to toggle")).toBeInTheDocument()
    expect(screen.getByText(/away tonight/)).toBeInTheDocument()
    fireEvent.click(consent())
    fireEvent.click(startButton())
    await screen.findByText("The live page")
    expect(bodyOf<{ present_player_ids: string[] }>(startCalls(writes())[0]!).present_player_ids).toEqual([
      "gm",
      "p1",
    ])
  })

  it("sends record_audio: false and cleanup: false when those are switched off", async () => {
    const { writes } = server()
    page()
    await screen.findByText("Session 3 · ready check")
    fireEvent.click(screen.getByRole("switch", { name: /Keep the audio recording/ }))
    fireEvent.click(screen.getByRole("switch", { name: /Fix names as it goes/ }))
    fireEvent.click(consent())
    fireEvent.click(startButton())
    await screen.findByText("The live page")
    expect(bodyOf(startCalls(writes())[0]!)).toMatchObject({ record_audio: false, cleanup: false })
  })

  it("links the guest pill to the players settings", async () => {
    server()
    page()
    expect(await screen.findByRole("link", { name: /Guest/ })).toHaveAttribute("href", "/settings/players")
  })

  it("shows the models and the last write-up, with Edit going to its recap", async () => {
    server()
    page({
      live: { session: session({ status: "idle", llm: { url: "u", model: "gemma-4", ok: false } }) },
    })
    expect(await screen.findByText("Not running")).toBeInTheDocument()
    expect(screen.getByText("gemma-4")).toBeInTheDocument()
    expect(screen.getByText("Ready · 2 known voices")).toBeInTheDocument()
    expect(await screen.findByText("The party reached the abbey at low tide.")).toBeInTheDocument()
    expect(screen.getByText(/sec read/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("href", "/sessions/s2/recap")
  })

  it("asks 'Start anyway?' when a check is red, and starts only on Start anyway", async () => {
    const { writes } = server()
    localStorage.setItem(MIC_KEY, "Yeti GX")
    page()
    await screen.findByRole("option", { name: "Yeti GX" })
    fireEvent.click(consent())
    fireEvent.click(startButton())
    expect(await screen.findByText("Start anyway?")).toBeInTheDocument()
    expect(screen.getByLabelText("Red checks")).toHaveTextContent("Picks up voices all aroundCardioid")
    expect(startCalls(writes())).toEqual([])

    fireEvent.click(screen.getByRole("button", { name: "Start anyway" }))
    expect(await screen.findByText("The live page")).toBeInTheDocument()
    expect(bodyOf(startCalls(writes())[0]!)).toMatchObject({ source: { kind: "mic", device: "Yeti GX" } })
  })

  it("asks too when the notes model is not running, and Cancel starts nothing", async () => {
    const { writes } = server()
    page({ live: { session: session({ status: "idle", llm: { url: "u", model: "m", ok: false } }) } })
    await screen.findByRole("option", { name: "Jabra Speak 710 (default)" })
    fireEvent.click(consent())
    fireEvent.click(startButton())
    expect(await screen.findByLabelText("Red checks")).toHaveTextContent("Notes & answers: Not running")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByText("Start anyway?")).toBeNull())
    expect(startCalls(writes())).toEqual([])
  })

  it("falls back to the default mic when the remembered one is unplugged", async () => {
    const { writes } = server()
    localStorage.setItem(MIC_KEY, "Gone Mic")
    page()
    await screen.findByRole("option", { name: "Jabra Speak 710 (default)" })
    fireEvent.click(consent())
    fireEvent.click(startButton())
    await screen.findByText("The live page")
    expect(bodyOf(startCalls(writes())[0]!)).toMatchObject({ source: { kind: "mic", device: null } })
  })

  it("remembers the chosen mic", async () => {
    server()
    page()
    await screen.findByRole("option", { name: "Yeti GX" })
    fireEvent.change(screen.getByLabelText("Microphone", { selector: "select" }), {
      target: { value: "mic:Yeti GX" },
    })
    expect(localStorage.getItem(MIC_KEY)).toBe("Yeti GX")
  })

  it("moves a mic saved under the pre-rename key to the new one", async () => {
    server()
    localStorage.setItem(OLD_MIC_KEY, "Yeti GX")
    page()
    await screen.findByRole("option", { name: "Yeti GX" })
    expect(localStorage.getItem(MIC_KEY)).toBe("Yeti GX")
    expect(localStorage.getItem(OLD_MIC_KEY)).toBeNull()
  })

  it("prefers the new key over the pre-rename one", async () => {
    server()
    localStorage.setItem(MIC_KEY, "Yeti GX")
    localStorage.setItem(OLD_MIC_KEY, "Jabra Speak 710")
    page()
    await screen.findByRole("option", { name: "Yeti GX" })
    expect(screen.getByLabelText("Microphone", { selector: "select" })).toHaveValue("mic:Yeti GX")
  })

  it("opens on the first sample file for ?source=file and starts a replay", async () => {
    const { writes } = server()
    page({ route: "/sessions/new?source=file" })
    await waitFor(() =>
      expect(screen.getByLabelText("Microphone", { selector: "select" })).toHaveValue("file:table.wav"),
    )
    fireEvent.click(consent())
    fireEvent.click(startButton())
    await screen.findByText("The live page")
    expect(bodyOf(startCalls(writes())[0]!)).toMatchObject({
      source: { kind: "file", name: "table.wav", speed: 1 },
    })
  })

  it("re-reads the inputs while idle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { calls } = server()
      page()
      await screen.findByRole("option", { name: "Jabra Speak 710 (default)" })
      const sourceReads = () => calls.filter((c) => c.url === "/api/sources").length
      const before = sourceReads()
      await act(() => vi.advanceTimersByTimeAsync(SOURCES_POLL_MS + 50))
      expect(sourceReads()).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it("points to the live session instead of offering a second start", async () => {
    server()
    page({ live: { session: session({ status: "running" }) } })
    expect(await screen.findByRole("button", { name: "Go to session" })).toHaveAttribute(
      "href",
      "/sessions/live",
    )
    expect(screen.queryByRole("button", { name: /Start session/ })).toBeNull()
  })
})
