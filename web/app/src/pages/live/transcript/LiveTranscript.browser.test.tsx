import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { applySpeaker, resetLive, useLiveStore } from "@troubadour/api/live"
import { keys, makeQueryClient } from "@troubadour/api/query"
import {
  answerSource,
  campaign,
  campaignAnswer,
  message,
  mockFetch,
  player,
  savedSession,
  session,
  voice,
} from "@troubadour/api/testing"
import { Toaster } from "@troubadour/ui/toast"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import "../../../index.css"
import { SessionAudioProvider } from "../../../components/audio/SessionAudioProvider.tsx"
import { shot } from "../../../../test/shot.ts"
import { LiveTranscript } from "./LiveTranscript.tsx"

const PLAYERS = [
  player({ id: "gm", name: "Alex", is_gm: true, color: null, dnd_class: "paladin" }),
  player({ id: "p1", name: "Maya", character: "Velis", color: null, dnd_class: "wizard" }),
]
const VOICES = [
  voice({ id: "v1", status: "named", player_id: "gm" }),
  voice({ id: "v2", status: "named", player_id: "p1" }),
  voice({ id: "v3", label: "Voice 3" }),
]
const LINES = [
  message({
    id: "a",
    voice_id: "v1",
    t_start: 5900,
    t_end: 5920,
    text: "The choir stops singing as you reach the stairs.",
  }),
  message({
    id: "b",
    voice_id: "v2",
    t_start: 5925,
    t_end: 5940,
    text: "I hold up the lantern and look down.",
  }),
  message({
    id: "c",
    voice_id: "v3",
    t_start: 5945,
    t_end: 5950,
    text: "Something is breathing in the dark.",
    confidence: 0.3,
  }),
]
const ANSWER = campaignAnswer({
  id: "q1",
  question: "Who guards the abbey stairs?",
  answer: "A choir of drowned monks keeps the stairs [S1]; Orsa said they “keep what the tide leaves” [S2].",
  sources: [
    answerSource({
      id: "S1",
      kind: "transcript",
      label: "Alex · Session 3 · 1:38:20",
      session: "now",
      t: 5900,
      excerpt: "The choir stops singing as you reach the stairs.",
    }),
    answerSource({
      id: "S2",
      kind: "transcript",
      label: "Orsa · Session 2 · 0:41",
      session: "old",
      t: 41,
      excerpt: "They keep what the tide leaves.",
    }),
  ],
  stats: { seconds: 4, transcripts: 3, notes: 214 },
})

let unmount = () => {}
afterEach(() => {
  unmount()
  applySpeaker(null)
  resetLive()
  document.body.innerHTML = ""
})

function mount() {
  mockFetch((c) =>
    c.url === "/api/campaign/ask"
      ? ANSWER
      : c.url === "/api/classes"
        ? []
        : c.url === "/api/sessions"
          ? []
          : undefined,
  )
  resetLive()
  useLiveStore.setState({
    loaded: true,
    connected: true,
    sessionAt: performance.now(),
    session: session({ t: 5952 }),
    players: PLAYERS,
    voices: VOICES,
    messages: LINES,
  })
  const client = makeQueryClient()
  client.setQueryData(keys.campaign(), campaign())
  client.setQueryData(keys.sessions(), [
    savedSession({ id: "old", started_at: 1 }),
    savedSession({ id: "now", started_at: 2 }),
  ])
  const host = document.createElement("div")
  host.style.height = "100dvh"
  host.style.width = "820px"
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <MemoryRouter>
            <section className="flex h-dvh min-w-0 flex-col bg-canvas text-ink">
              <LiveTranscript highlightT={null} onPinned={() => {}} />
            </section>
            <Toaster />
          </MemoryRouter>
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  unmount = () => root.unmount()
}

describe("live transcript", () => {
  it("shows lines, the speaking footer and the ask bar", async () => {
    mount()
    applySpeaker("v1")
    await expect.element(page.getByText("Alex is speaking…")).toBeVisible()
    await shot("live-transcript")
  })

  it("shows an answer above the bar", async () => {
    mount()
    await userEvent.fill(
      page.getByRole("textbox", { name: /Ask a question/ }),
      "Who guards the abbey stairs?",
    )
    await userEvent.keyboard("{Enter}")
    await expect.element(page.getByText("Answered on this Mac", { exact: false })).toBeVisible()
    await shot("live-transcript-answer")
  })

  it("shows the who-said-this picker", async () => {
    mount()
    await userEvent.click(page.getByRole("button", { name: "Maya" }))
    await expect.element(page.getByText("Who said this line?")).toBeVisible()
    await shot("live-transcript-picker")
  })

  it("pins a note with a toast", async () => {
    mount()
    await userEvent.fill(page.getByRole("textbox", { name: /Ask a question/ }), "Ask about the key")
    await userEvent.keyboard("{Enter}")
    await expect.element(page.getByText(/^Pinned at/)).toBeVisible()
    await shot("live-transcript-pinned")
  })
})
