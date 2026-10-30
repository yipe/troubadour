import { act, fireEvent, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Notebook as NotebookData, NotebookItem } from "@troubadour/api/notebook"
import { keys } from "@troubadour/api/query"
import { bodyOf, mockFetch, player, session } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../test/render.tsx"
import { Notebook } from "./Notebook.tsx"

const notify = vi.hoisted(() => vi.fn())
vi.mock("@troubadour/ui/toast", () => ({ notify }))

const item = (over: Partial<NotebookItem>): NotebookItem => ({
  id: "i",
  kind: "fact",
  text: "A fact.",
  old: null,
  about: null,
  entry_type: null,
  said_by: null,
  t: 10,
  line_id: null,
  confidence: null,
  count: null,
  status: "open",
  ...over,
})
const NB: NotebookData = {
  session_id: "s1",
  updating: false,
  pins: [{ id: "p1", t: 90, text: "Ask about the bell", created_at: 1 }],
  items: [
    item({ id: "f1", text: "Old fact", t: 100, said_by: { name: "Maya", player_id: "p1" } }),
    item({ id: "f2", text: "Newer fact", t: 200 }),
    item({ id: "u1", kind: "update", text: "Square now", old: "Owes 20 gold", t: 150 }),
    item({ id: "f3", text: "Gone fact", t: 5, status: "dismissed" }),
    item({ id: "n1", kind: "entry", text: "The Abbot", t: 60 }),
    item({ id: "n2", kind: "spelling", text: "Isolde to Ysolde", t: 70 }),
  ],
}

function setup(nb: NotebookData | null = NB) {
  const calls: { url: string; body: unknown }[] = []
  mockFetch((c) => {
    if (c.url.startsWith("/api/session/notebook/")) {
      calls.push({ url: c.url, body: bodyOf(c) })
      return item({ id: c.url.split("/").pop()!, status: bodyOf<{ status: "kept" }>(c).status })
    }
    return c.url === "/api/classes" ? [] : undefined
  })
  const onJump = vi.fn()
  // The page owns the tab; this stands in for it.
  const Host = () => {
    const [tab, setTab] = useState("facts")
    return <Notebook tab={tab} onJump={onJump} onTabChange={setTab} />
  }
  const r = renderWithProviders(<Host />, {
    live: { session: session(), players: [player({ id: "p1", name: "Maya" })] },
    queryData: nb ? [[keys.notebook(), nb]] : [],
  })
  return { ...r, calls, onJump }
}

beforeEach(() => notify.mockClear())

describe("Notebook", () => {
  it("counts visible items per tab and lists newest first, hiding dismissed ones", () => {
    setup()
    expect(screen.getByRole("tab", { name: /Facts\s*3/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Names\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Pins\s*1/ })).toBeInTheDocument()
    const texts = screen.getAllByText(/^(Newer fact|Square now|Old fact)$/).map((e) => e.textContent)
    expect(texts).toEqual(["Newer fact", "Square now", "Old fact"])
    expect(screen.queryByText("Gone fact")).toBeNull()
  })

  it("labels the keep button by kind", () => {
    setup()
    expect(screen.getByRole("button", { name: "Keep update" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Keep" })).toHaveLength(2)
  })

  it("Keep marks the card kept and tells the server", async () => {
    const { calls } = setup()
    fireEvent.click(screen.getAllByRole("button", { name: "Keep" })[0]!)
    expect(await screen.findByText("✓ Kept")).toBeInTheDocument()
    expect(screen.getByText("1 kept for review")).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(calls).toEqual([{ url: "/api/session/notebook/f2", body: { status: "kept" } }]),
    )
  })

  it("Dismiss hides the card and Undo brings it back", async () => {
    setup()
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!)
    await vi.waitFor(() => expect(screen.queryByText("Newer fact")).toBeNull())
    expect(notify).toHaveBeenCalledWith("Dismissed", { undo: expect.any(Function) })
    await act(async () => notify.mock.calls[0]![1].undo())
    expect(await screen.findByText("Newer fact")).toBeInTheDocument()
  })

  it("the timestamp jumps the transcript", () => {
    const { onJump } = setup()
    fireEvent.click(screen.getByRole("button", { name: /3:20/ }))
    expect(onJump).toHaveBeenCalledWith(200)
  })

  it("Names and Pins tabs show their own cards", () => {
    setup()
    fireEvent.click(screen.getByRole("tab", { name: /Names/ }))
    expect(screen.getByRole("button", { name: "Add to codex" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /Pins/ }))
    expect(screen.getByText("Ask about the bell")).toBeInTheDocument()
    expect(screen.getByText("Pinned by you")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull()
  })

  it("shows empty texts", () => {
    setup({ ...NB, items: [], pins: [] })
    expect(screen.getByText(/Facts show up a few minutes/)).toBeInTheDocument()
    expect(screen.getByText("kept facts go to the review")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /Pins/ }))
    expect(screen.getByText(/Type a note in the bar below/)).toBeInTheDocument()
  })

  it("a refreshed notebook re-renders, with a spinner while updating", async () => {
    const { client } = setup()
    expect(screen.queryByRole("status")).toBeNull()
    act(() =>
      client.setQueryData(keys.notebook(), {
        ...NB,
        updating: true,
        items: [...NB.items, item({ id: "f9", text: "Brand new fact", t: 300 })],
      }),
    )
    expect(await screen.findByText("Brand new fact")).toBeInTheDocument()
    expect(screen.getByRole("status")).toBeInTheDocument()
  })
})
