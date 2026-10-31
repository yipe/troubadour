import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { applyAudioEvent, applySpeaker, resetLive, useLiveStore } from "@troubadour/api/live"
import { makeQueryClient } from "@troubadour/api/query"
import { audioQuality, message, mockFetch, player, session, voice } from "@troubadour/api/testing"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import { Toaster } from "@troubadour/ui/toast"
import "../../index.css"
import { SessionAudioProvider } from "../../components/audio/SessionAudioProvider.tsx"
import { shot } from "../../../test/shot.ts"
import { LivePage } from "./LivePage.tsx"

const PLAYERS = [
  player({ id: "gm", name: "Alex", is_gm: true, color: null, dnd_class: "paladin" }),
  player({ id: "p1", name: "Maya", character: "Velis", color: null, dnd_class: "wizard" }),
  player({ id: "p2", name: "Sam", character: "Brann", color: null, dnd_class: "fighter" }),
  player({ id: "p3", name: "Jo", color: null, dnd_class: null }),
]
const VOICES = [
  voice({ id: "v1", label: "Voice 1", status: "named", player_id: "gm" }),
  voice({ id: "v2", label: "Voice 2", status: "named", player_id: "p1" }),
  voice({ id: "v3", label: "Voice 3", status: "named", player_id: "p2" }),
  voice({ id: "v4", label: "Voice 4", seconds: 4, suggested_player_id: "gm", sample_url: "/x.wav" }),
]
const LINES = [
  message({ id: "a", voice_id: "v1", t_start: 0, t_end: 300 }),
  message({ id: "b", voice_id: "v2", t_start: 300, t_end: 520 }),
  message({ id: "c", voice_id: "v3", t_start: 520, t_end: 600 }),
]

let unmount = () => {}
afterEach(() => {
  unmount()
  applySpeaker(null)
  resetLive()
  document.body.innerHTML = ""
})

function mount(status: "running" | "paused" = "running") {
  mockFetch((c) => (c.url === "/api/classes" ? [] : c.url === "/api/sessions" ? [] : undefined))
  resetLive()
  useLiveStore.setState({
    loaded: true,
    connected: true,
    sessionAt: performance.now(),
    session: session({
      status,
      title: "The drowned abbey",
      source: { kind: "mic", device: "Jabra Speak 710" },
    }),
    players: PLAYERS,
    voices: VOICES,
    messages: LINES,
  })
  const host = document.createElement("div")
  host.style.height = "100dvh"
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <SessionAudioProvider>
          <MemoryRouter>
            <div className="flex h-dvh flex-col bg-canvas text-ink">
              <main className="min-h-0 flex-1">
                <LivePage />
              </main>
            </div>
            <Toaster />
          </MemoryRouter>
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  unmount = () => root.unmount()
}

describe("live page layout", () => {
  it("has a 250px rail and a 440px notebook column", async () => {
    mount()
    await expect.element(page.getByText("The drowned abbey")).toBeVisible()
    const rail = document.querySelector("aside")!
    expect(rail.getBoundingClientRect().width).toBe(250)
    expect(document.querySelectorAll("aside")[1]!.getBoundingClientRect().width).toBe(440)
    await shot("live-rail-listening")
  })

  it("lights the speaker and shows the pending card", async () => {
    mount()
    applySpeaker("v2")
    await expect.element(page.getByText(/4 s heard/)).toBeVisible()
    await expect
      .poll(() => document.querySelector('[data-player-id="p1"]')?.hasAttribute("data-speaking"))
      .toBe(true)
    await shot("live-rail-speaking")
  })

  it("shows the paused state", async () => {
    mount("paused")
    await expect.element(page.getByText("Paused · not listening")).toBeVisible()
    await shot("live-rail-paused")
  })

  it("opens the audio quality popover", async () => {
    mount()
    applyAudioEvent({ type: "audio.quality", data: audioQuality({ source: "session" }) })
    await userEvent.click(page.getByText(/Listening · Jabra/))
    await expect.element(page.getByText("Audio quality", { exact: true }).first()).toBeVisible()
    await shot("live-quality-popover")
  })

  it("opens the voices popover", async () => {
    mount()
    await userEvent.click(page.getByRole("button", { name: /Voices/ }))
    await expect.element(page.getByText("Voice 4").first()).toBeVisible()
    await shot("live-voices-popover")
  })
})
