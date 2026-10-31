import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import type { Review, ReviewItem } from "@troubadour/api/review"
import { makeQueryClient } from "@troubadour/api/query"
import {
  campaign,
  campaignJob,
  entity,
  factSuggestion,
  mockFetch,
  recordMessage,
  savedSession,
  sessionRecord,
} from "@troubadour/api/testing"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import { Toaster } from "@troubadour/ui/toast"
import "../../index.css"
import { SessionAudioProvider } from "../../components/audio/SessionAudioProvider.tsx"
import { shot } from "../../../test/shot.ts"
import { Component as ReviewPage } from "./index.tsx"

const PLAYERS = [
  { id: "gm", name: "Alex", character: "", is_gm: true, color: "#e0a030" },
  { id: "p2", name: "Sam", character: "Brann", is_gm: false, color: "#e07050" },
  { id: "p3", name: "Maya", character: "Velis", is_gm: false, color: "#5090d0" },
]
const SAYS: [string, string, string, string][] = [
  ["m1", "gm", "The abbey doors are swollen with seawater. When you push, they groan open.", "1:36:14"],
  ["m2", "gm", "Somewhere below, a bell rings once.", "1:36:40"],
  ["m3", "gm", "You’ll want to be quick. The tide turns at the second bell.", "1:38:02"],
  ["m4", "p2", "Then I’m going first. Brann doesn’t wait for bells.", "1:38:40"],
  ["m5", "gm", "Wait, Orsa, you said the abbot keeps the diamond under the bell. Didn’t you?", "1:39:12"],
  [
    "m6",
    "p3",
    "The tide’s tongue. That’s the clapper. The Diamond of Isolde is in the bell itself.",
    "1:40:31",
  ],
  [
    "m7",
    "gm",
    "There’s a faint necromantic glow beneath the floor, right where the bell’s shadow falls.",
    "1:41:55",
  ],
]
const at = (hms: string) => hms.split(":").reduce((n, p) => n * 60 + Number(p), 0)
const record = sessionRecord({
  id: "s1",
  players: PLAYERS,
  messages: SAYS.map(([id, who, text, t]) => {
    const p = PLAYERS.find((x) => x.id === who)!
    return recordMessage({
      id,
      t_start: at(t),
      speaker: p.name,
      player_id: p.id,
      character: p.character,
      text,
    })
  }),
})

const fact = (
  id: string,
  line: string,
  text: string,
  over: Partial<ReviewItem> = {},
  conf = "gm" as const,
): ReviewItem => ({
  id: `fact:${id}`,
  kind: "fact",
  line_id: line,
  t: null,
  status: "open",
  preaccepted: false,
  fact: factSuggestion({ id, text, about: "Drowned Abbey", confidence: conf }),
  spelling: null,
  entry: null,
  ...over,
})

const ITEMS: ReviewItem[] = [
  fact("1", "m3", "The tide turns at the second bell.", { status: "accepted" }),
  {
    id: "entry:abbot",
    kind: "entry",
    line_id: "m5",
    t: null,
    status: "open",
    preaccepted: false,
    fact: null,
    spelling: null,
    entry: { name: "The Abbot", type: "npc", description: "Keeps the diamond, according to Pip." },
  },
  fact("2", "m6", "The diamond is hidden in the abbey bell’s clapper.", {}, "theory" as never),
  {
    id: "spelling:isolde",
    kind: "spelling",
    line_id: "m6",
    t: null,
    status: "open",
    preaccepted: false,
    fact: null,
    spelling: { heard: "Isolde", entity: "Ysolde", count: 2 },
    entry: null,
  },
  fact("3", "m7", "Necromantic magic lies under the bell’s shadow.", { preaccepted: true }),
  fact("4", "m2", "A bell rings below the abbey.", { status: "rejected" }),
]

let unmount = () => {}
afterEach(() => {
  unmount()
  document.body.innerHTML = ""
})

function mount(items: ReviewItem[], writtenUp = true) {
  const review: Review = {
    session_id: "s1",
    written_up: writtenUp,
    items,
    counts: {
      total: 14,
      done: 5,
      fact: items.filter((i) => i.kind === "fact").length,
      spelling: items.filter((i) => i.kind === "spelling").length,
      entry: items.filter((i) => i.kind === "entry").length,
    },
  }
  mockFetch((c) => {
    if (c.url === "/api/sessions") return [savedSession({ id: "s1", title: "The Drowned Abbey", n: 12 })]
    if (c.url === "/api/sessions/s1/transcript.json") return record
    if (c.url === "/api/sessions/s1/review") return review
    if (c.url === "/api/campaign")
      return campaign({
        entities: [entity({ name: "Diamond of Ysolde" })],
        jobs: writtenUp
          ? []
          : [
              campaignJob({
                id: "j1",
                kind: "writeup",
                title: "s1",
                state: "running",
                done: 2,
                total: 5,
                message: "Writing the session page",
              }),
            ],
      })
    return []
  })
  const host = document.createElement("div")
  host.style.height = "100dvh"
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <SessionAudioProvider>
          <MemoryRouter initialEntries={["/sessions/s1/review"]}>
            <div className="flex h-dvh flex-col bg-canvas text-ink">
              <main className="min-h-0 flex-1">
                <Routes>
                  <Route path="/sessions/:id/review" element={<ReviewPage />} />
                </Routes>
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

describe("review page", () => {
  it("shows notes beside their lines, open, accepted and decided", async () => {
    mount(ITEMS)
    await expect.element(page.getByText("Keeps the diamond, according to Pip.")).toBeVisible()
    const row = (id: string) => document.querySelector<HTMLElement>(`[data-line-id="${id}"]`)!
    // The wash and the 3px edge sit on the line, not the note.
    expect(getComputedStyle(row("m5").firstElementChild!).boxShadow).not.toBe("none")
    expect(getComputedStyle(row("m1").firstElementChild!).boxShadow).toBe("none")
    // The note column is 460px wide, after a 28px gap.
    const note = row("m5").querySelector("[data-review]")!.firstElementChild!
    expect(Math.round(note.getBoundingClientRect().width)).toBe(460)
    await shot("review-margin-notes")
  })

  it("opens the editor on a fact", async () => {
    mount(ITEMS)
    await userEvent.click(page.getByRole("button", { name: "Edit" }).nth(1))
    await expect.element(page.getByLabelText("Fact text")).toBeVisible()
    await shot("review-edit")
  })

  it("asks for a name for an unknown word", async () => {
    mount([
      {
        id: "spelling:zorbo",
        kind: "spelling",
        line_id: "m6",
        t: null,
        status: "open",
        preaccepted: false,
        fact: null,
        spelling: { heard: "Zorbo", entity: null, count: 1 },
        entry: null,
      },
    ])
    await userEvent.click(page.getByRole("button", { name: "Add to codex" }))
    await expect.element(page.getByLabelText(/Name for the new codex entry/)).toBeVisible()
    await shot("review-unknown-word")
  })

  it("shows the running write-up with notebook-only items", async () => {
    mount([fact("9", "", "Kept from the live notebook.", { line_id: null, preaccepted: true })], false)
    await expect.element(page.getByText("The write-up is still running")).toBeVisible()
    await expect.element(page.getByText("From the live notebook")).toBeVisible()
    await shot("review-not-written-up")
  })

  it("asks before finishing with open suggestions", async () => {
    mount(ITEMS)
    await userEvent.click(page.getByRole("button", { name: "Finish review" }))
    await expect.element(page.getByText(/still open\. They stay in the codex/)).toBeVisible()
    await shot("review-finish-confirm")
  })
})
