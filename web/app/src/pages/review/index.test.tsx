import { forwardRef, type ComponentProps } from "react"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { VirtuosoMockContext, type VirtuosoHandle } from "react-virtuoso"
import { Route, Routes } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import type { Fact } from "@troubadour/api/campaign"
import type { Review, ReviewItem } from "@troubadour/api/review"
import {
  bodyOf,
  campaign,
  fact as confirmedFact,
  entity,
  factSuggestion,
  httpError,
  mockFetch,
  recordMessage,
  savedSession,
  sessionRecord,
} from "@troubadour/api/testing"
import { notify } from "@troubadour/ui/toast"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as ReviewPage } from "./index.tsx"

// jsdom has no layout, so `initialTopMostItemIndex` renders no rows; strip it.
vi.mock("react-virtuoso", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-virtuoso")>()
  const Virtuoso = forwardRef<VirtuosoHandle, ComponentProps<typeof mod.Virtuoso>>(
    function Virtuoso(props, ref) {
      return <mod.Virtuoso {...props} ref={ref} initialTopMostItemIndex={undefined} />
    },
  )
  return { ...mod, Virtuoso }
})

vi.mock("@troubadour/ui/toast", () => ({ notify: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(notify).mockClear()
})

const record = sessionRecord({
  id: "s1",
  players: [{ id: "p1", name: "Alex", character: "", is_gm: true, color: "#10b981" }],
  messages: [
    recordMessage({ id: "a", t_start: 1, speaker: "Alex", player_id: "p1", text: "The tide turns" }),
    recordMessage({ id: "b", t_start: 30, speaker: "Alex", player_id: "p1", text: "The abbot has it" }),
    recordMessage({ id: "c", t_start: 60, speaker: "Alex", player_id: "p1", text: "Hear Isolde sing" }),
    recordMessage({ id: "d", t_start: 90, speaker: "Alex", player_id: "p1", text: "A stranger, Zorbo" }),
  ],
})

const fact = (id: string, over: Partial<ReviewItem> = {}, text = `Fact ${id}`): ReviewItem => ({
  id: `fact:${id}`,
  kind: "fact",
  line_id: "a",
  t: 1,
  status: "open",
  preaccepted: false,
  fact: factSuggestion({ id, text, about: "Drowned Abbey", confidence: "gm" }),
  spelling: null,
  entry: null,
  ...over,
})
const entryItem: ReviewItem = {
  id: "entry:abbot",
  kind: "entry",
  line_id: "b",
  t: 30,
  status: "open",
  preaccepted: false,
  fact: null,
  spelling: null,
  entry: { name: "The Abbot", type: "npc", description: "Keeps the diamond." },
}
const spelling: ReviewItem = {
  id: "spelling:isolde",
  kind: "spelling",
  line_id: "c",
  t: 60,
  status: "open",
  preaccepted: false,
  fact: null,
  spelling: { heard: "Isolde", entity: "Ysolde", count: 2 },
  entry: null,
}
const unknown: ReviewItem = {
  ...spelling,
  id: "spelling:zorbo",
  line_id: "d",
  spelling: { heard: "Zorbo", entity: null, count: 1 },
}

function open(
  items: ReviewItem[],
  options: { writtenUp?: boolean; fail?: string; facts?: Fact[]; failReviewed?: boolean } = {},
) {
  const state = new Map(items.map((i) => [i.id, i]))
  const review = (): Review => {
    const all = [...state.values()]
    return {
      session_id: "s1",
      written_up: options.writtenUp ?? true,
      items: all,
      counts: {
        total: all.length,
        done: all.filter((i) => i.status !== "open").length,
        fact: all.filter((i) => i.kind === "fact").length,
        spelling: all.filter((i) => i.kind === "spelling").length,
        entry: all.filter((i) => i.kind === "entry").length,
      },
    }
  }
  const fetchMock = mockFetch((c) => {
    if (c.url === "/api/sessions") return [savedSession({ id: "s1", title: "The Drowned Abbey", n: 12 })]
    if (c.url === "/api/sessions/s1/transcript.json") return record
    if (c.url === "/api/sessions/s1/review") return review()
    if (c.url === "/api/campaign")
      return campaign({ facts: options.facts, entities: [entity({ name: "Diamond of Ysolde" })] })
    if (c.url === "/api/sessions/s1/reviewed")
      return options.failReviewed ? httpError(500, "Disk full.") : { id: "s1", reviewed_at: 1 }
    if (c.method === "POST" && c.url.startsWith("/api/sessions/s1/review/")) {
      const id = decodeURIComponent(c.url.split("/review/")[1]!)
      if (id === options.fail) return httpError(500, "The vault refused.")
      const body = bodyOf<{ action: string }>(c)
      const next = {
        ...state.get(id)!,
        status: body.action === "accept" ? "accepted" : "rejected",
      } as ReviewItem
      state.set(id, next)
      return next
    }
    return []
  })
  renderWithProviders(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 900, itemHeight: 80 }}>
      <Routes>
        <Route path="/sessions/:id/review" element={<ReviewPage />} />
        <Route path="/sessions/:id" element={<p>Session page</p>} />
      </Routes>
    </VirtuosoMockContext.Provider>,
    { route: "/sessions/s1/review" },
  )
  const decisions = () =>
    fetchMock
      .writes()
      .filter((c) => c.url.includes("/review/"))
      .map((c) => [decodeURIComponent(c.url.split("/review/")[1]!), c.body])
  return { ...fetchMock, decisions }
}

const click = (name: string | RegExp, index = 0) =>
  fireEvent.click(screen.getAllByRole("button", { name })[index]!)

it("shows the header, the progress and the filter counts", async () => {
  open([fact("1", { status: "accepted" }), fact("2", { line_id: "b" }), entryItem, spelling])
  expect(await screen.findByRole("heading", { name: "The Drowned Abbey" })).toBeInTheDocument()
  expect(screen.getByText(/Review · Session 12/)).toBeInTheDocument()
  expect(screen.getByText("1 of 4 reviewed")).toBeInTheDocument()
  expect(screen.getByText("~1 min left")).toBeInTheDocument()
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25")
  expect(screen.getByRole("button", { name: /^All\s*4$/ })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /^Facts\s*2$/ })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /^Spellings\s*1$/ })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /^New entries\s*1$/ })).toBeInTheDocument()
  expect(screen.getByText("✓ Accepted")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Accept all GM-stated (1)" })).toBeInTheDocument()
})

it("hides the notes that don't match a filter but keeps every line", async () => {
  open([fact("1"), entryItem, spelling])
  await screen.findByText("Fact 1")
  fireEvent.click(screen.getByRole("button", { name: /^Spellings/ }))
  expect(screen.queryByText("Fact 1")).not.toBeInTheDocument()
  expect(screen.getByText(/Fixed in 2 lines/)).toBeInTheDocument()
  expect(screen.getByText("The tide turns")).toBeInTheDocument()
  expect(screen.getByText("The abbot has it")).toBeInTheDocument()
})

it("accepts and rejects each kind with the right body", async () => {
  const t = open([fact("1"), entryItem, spelling, unknown])
  await screen.findByText("Fact 1")
  click("Accept", 0) // the fact
  await screen.findByText("✓ Accepted")
  click("Add to codex", 0) // the entry
  await waitFor(() => expect(screen.getAllByText("✓ Accepted")).toHaveLength(2))
  click("Reject", 0) // the known spelling is the first open one left
  await screen.findByText("Rejected")
  expect(t.decisions()).toEqual([
    ["fact:1", { action: "accept" }],
    ["entry:abbot", { action: "accept" }],
    ["spelling:isolde", { action: "reject" }],
  ])
})

it("accepts a known spelling", async () => {
  const t = open([spelling])
  await screen.findByText(/Fixed in 2 lines/)
  click("Accept")
  await screen.findByText("✓ Accepted")
  expect(t.decisions()).toEqual([["spelling:isolde", { action: "accept" }]])
})

it("asks for a name before adding an unknown word to the codex", async () => {
  const t = open([unknown])
  await screen.findByText(/Unknown word/)
  click("Add to codex")
  const input = screen.getByLabelText(/Name for the new codex entry/)
  expect(input).toHaveValue("Zorbo")
  fireEvent.change(input, { target: { value: "Zorbo the Bold" } })
  fireEvent.click(screen.getAllByRole("button", { name: "Add to codex" }).at(-1)!)
  await screen.findByText("✓ Accepted")
  expect(t.decisions()).toEqual([["spelling:zorbo", { action: "accept", text: "Zorbo the Bold" }]])
})

it("sends the edited text when a fact is edited and then accepted", async () => {
  const t = open([fact("1")])
  await screen.findByText("Fact 1")
  click("Edit")
  fireEvent.change(screen.getByLabelText("Fact text"), { target: { value: "The tide turns at the bell." } })
  fireEvent.click(screen.getByRole("button", { name: "Accept with edits" }))
  await screen.findByText("✓ Accepted")
  expect(t.decisions()).toEqual([["fact:1", { action: "accept", text: "The tide turns at the bell." }]])
})

it("does not accept an edited fact whose text was emptied", async () => {
  const t = open([fact("1")])
  await screen.findByText("Fact 1")
  click("Edit")
  fireEvent.change(screen.getByLabelText("Fact text"), { target: { value: "   " } })
  fireEvent.click(screen.getByRole("button", { name: "Accept with edits" }))
  await new Promise((r) => setTimeout(r, 50))
  expect(t.decisions()).toEqual([])
})

it("reports a failed finish and stays on the review", async () => {
  open([fact("1", { status: "accepted" })], { failReviewed: true })
  await screen.findByText("✓ Accepted")
  fireEvent.click(screen.getByRole("button", { name: "Finish review" }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith("Disk full.", { tone: "danger" }))
  expect(notify).not.toHaveBeenCalledWith("Session 12 reviewed")
  expect(screen.queryByText("Session page")).toBeNull()
})

it("moves an edited fact to another entry", async () => {
  const t = open([fact("1")])
  await screen.findByText("Fact 1")
  click("Edit")
  fireEvent.click(screen.getByRole("button", { name: "About" }))
  fireEvent.click(await screen.findByText("Diamond of Ysolde"))
  fireEvent.click(screen.getByRole("button", { name: "Accept with edits" }))
  await screen.findByText("✓ Accepted")
  expect(t.decisions()).toEqual([
    ["fact:1", { action: "accept", text: "Fact 1", about: "Diamond of Ysolde" }],
  ])
})

it("shows what an update replaces, struck through", async () => {
  const update = fact("2", {
    fact: factSuggestion({ id: "2", text: "New wording.", about: "Orsa", replaces: "1", kind: "update" }),
  })
  open([update], { facts: [confirmedFact({ id: "1", text: "Old wording." })] })
  expect(await screen.findByText("Old wording.")).toHaveClass("line-through")
  expect(screen.getByText("New wording.")).not.toHaveClass("line-through")
  expect(screen.getByText("Updates a fact")).toBeInTheDocument()
})

it("accepts all GM-stated facts one after another and skips the others", async () => {
  const theory = fact("3", {
    line_id: "b",
    fact: factSuggestion({ id: "3", text: "A theory", about: "X", confidence: "theory" }),
  })
  const t = open([fact("1"), fact("2", { line_id: "c" }), theory])
  await screen.findByText("Fact 1")
  fireEvent.click(screen.getByRole("button", { name: "Accept all GM-stated (2)" }))
  await waitFor(() => expect(screen.getAllByText("✓ Accepted")).toHaveLength(2))
  expect(t.decisions()).toEqual([
    ["fact:1", { action: "accept" }],
    ["fact:2", { action: "accept" }],
  ])
  expect(screen.getByRole("button", { name: "Accept all GM-stated (0)" })).toBeDisabled()
})

it("stops accepting all at the first error and reports it", async () => {
  const t = open([fact("1"), fact("2", { line_id: "c" }), fact("3", { line_id: "d" })], { fail: "fact:2" })
  await screen.findByText("Fact 1")
  fireEvent.click(screen.getByRole("button", { name: "Accept all GM-stated (3)" }))
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith("Stopped at 2 of 3: The vault refused.", { tone: "danger" }),
  )
  expect(t.decisions().map(([id]) => id)).toEqual(["fact:1", "fact:2"])
  expect(screen.getByRole("button", { name: "Accept all GM-stated (2)" })).toBeInTheDocument()
})

it("finishes: marks the session reviewed and goes to its page", async () => {
  const t = open([fact("1", { status: "accepted" })])
  await screen.findByText("✓ Accepted")
  fireEvent.click(screen.getByRole("button", { name: "Finish review" }))
  expect(await screen.findByText("Session page")).toBeInTheDocument()
  expect(t.writes().map((c) => [c.url, c.body])).toEqual([["/api/sessions/s1/reviewed", { reviewed: true }]])
  expect(notify).toHaveBeenCalledWith("Session 12 reviewed")
})

it("asks before finishing with open items", async () => {
  const t = open([fact("1"), fact("2", { line_id: "b" })])
  await screen.findByText("Fact 1")
  fireEvent.click(screen.getByRole("button", { name: "Finish review" }))
  const dialog = await screen.findByRole("dialog")
  expect(
    within(dialog).getByText("2 suggestions are still open. They stay in the codex as suggestions."),
  ).toBeInTheDocument()
  expect(t.writes()).toHaveLength(0)
  fireEvent.click(within(dialog).getByRole("button", { name: "Finish review" }))
  expect(await screen.findByText("Session page")).toBeInTheDocument()
  expect(t.writes()).toHaveLength(1)
})

it("says the write-up is running and lists notebook-only items below the lines", async () => {
  const loose = fact("9", { line_id: null }, "Kept from the notebook")
  open([loose], { writtenUp: false })
  expect(await screen.findByText("This session isn’t written up yet")).toBeInTheDocument()
  expect(screen.getByText("From the live notebook")).toBeInTheDocument()
  expect(screen.getByText("Kept from the notebook")).toBeInTheDocument()
})
