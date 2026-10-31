import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { resetLive, useLiveStore } from "@troubadour/api/live"
import type { Notebook as NotebookData, NotebookItem } from "@troubadour/api/notebook"
import { keys, makeQueryClient } from "@troubadour/api/query"
import { mockFetch, player, session } from "@troubadour/api/testing"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import "../../../index.css"
import { SessionAudioProvider } from "../../../components/audio/SessionAudioProvider.tsx"
import { shot } from "../../../../test/shot.ts"
import { Notebook } from "./Notebook.tsx"

const item = (over: Partial<NotebookItem>): NotebookItem => ({
  id: "i",
  kind: "fact",
  text: "",
  old: null,
  about: null,
  entry_type: null,
  said_by: null,
  t: 0,
  line_id: null,
  confidence: "gm",
  count: null,
  status: "open",
  ...over,
})
const NB: NotebookData = {
  session_id: "s1",
  updating: true,
  pins: [{ id: "p1", t: 6000, text: "Ask Orsa about the bell", created_at: 1 }],
  items: [
    item({
      id: "f1",
      text: "Necromantic magic lies beneath the abbey bell's shadow.",
      said_by: { name: "Alex", player_id: null },
      t: 6115,
    }),
    item({
      id: "f2",
      text: "The Diamond is hidden in the bell clapper.",
      said_by: { name: "Maya", player_id: "p1" },
      confidence: "theory",
      t: 6031,
    }),
    item({
      id: "f3",
      text: "The tide turns at the second bell.",
      said_by: { name: "Alex", player_id: null },
      t: 5882,
      status: "kept",
    }),
    item({
      id: "u1",
      kind: "update",
      text: "Orsa Vell paid Pip back. They're square.",
      old: "Orsa Vell owes Pip 20 gold.",
      said_by: { name: "Sam", player_id: null },
      t: 6178,
    }),
    item({
      id: "n1",
      kind: "entry",
      text: "The Abbot",
      about: "The Abbot",
      entry_type: "npc",
      said_by: { name: "Jo", player_id: null },
      confidence: "once",
      t: 5952,
    }),
    item({ id: "n2", kind: "spelling", text: "Isolde to Ysolde", t: 6031, confidence: null }),
  ],
}

let unmount = () => {}
afterEach(() => {
  unmount()
  resetLive()
  document.body.innerHTML = ""
})

function mount(tab: string, nb: NotebookData) {
  mockFetch((c) => (c.url === "/api/classes" ? [] : undefined))
  resetLive()
  useLiveStore.setState({
    loaded: true,
    connected: true,
    session: session(),
    players: [
      player({ id: "gm", name: "Alex", is_gm: true, color: null, dnd_class: "paladin" }),
      player({ id: "p1", name: "Maya", color: null, dnd_class: "wizard" }),
      player({ id: "p2", name: "Sam", color: null, dnd_class: "fighter" }),
    ],
  })
  const client = makeQueryClient()
  client.setQueryData(keys.notebook(), nb)
  const host = document.createElement("div")
  host.style.height = "100dvh"
  host.style.width = "440px"
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <MemoryRouter>
            <aside className="flex h-full w-[440px] flex-col border-l border-line bg-sunken text-ink">
              <Notebook tab={tab} onTabChange={() => {}} onJump={() => {}} />
            </aside>
          </MemoryRouter>
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  unmount = () => root.unmount()
}

describe("notebook look", () => {
  it("facts, with a kept card and an update", async () => {
    mount("facts", NB)
    await expect.element(page.getByText("Tonight's notebook")).toBeVisible()
    await shot("live-notebook-facts")
  })
  it("names", async () => {
    mount("names", NB)
    await expect.element(page.getByText("Add to codex")).toBeVisible()
    await shot("live-notebook-names")
  })
  it("pins", async () => {
    mount("pins", NB)
    await expect.element(page.getByText("Pinned by you")).toBeVisible()
    await shot("live-notebook-pins")
  })
  it("empty", async () => {
    mount("facts", { ...NB, items: [], pins: [], updating: false })
    await expect.element(page.getByText(/Nothing new yet/)).toBeVisible()
    await shot("live-notebook-empty")
  })
})
