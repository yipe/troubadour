import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ServerEvent } from "../events/index.ts"
import { makeQueryClient } from "../query/client.ts"
import { bridgeSocket } from "../query/bridge.ts"
import { keys } from "../query/keys.ts"
import type { Socket } from "../socket/index.ts"
import { bodyOf, httpError, mockFetch, snapshot } from "../testing/index.ts"
import { useAddPin, useNotebook, useSessionNotebook, useSetNotebookStatus } from "./queries.ts"
import type { Notebook, NotebookItem } from "./types.ts"

let client: QueryClient
beforeEach(() => {
  client = makeQueryClient()
})
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const item = (over: Partial<NotebookItem> = {}): NotebookItem => ({
  id: "i1",
  kind: "fact",
  text: "The gate opens at low water.",
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
const notebook = (over: Partial<Notebook> = {}): Notebook => ({
  session_id: "s1",
  items: [item()],
  pins: [],
  updating: false,
  ...over,
})

function fakeSocket() {
  const handlers = new Map<string, Set<(d: never) => void>>()
  const socket = {
    on: (type: string, h: (d: never) => void) => {
      const set = handlers.get(type) ?? new Set()
      handlers.set(type, set)
      set.add(h)
      return () => set.delete(h)
    },
  } as unknown as Socket
  const emit = (ev: ServerEvent) => {
    for (const h of handlers.get(ev.type) ?? []) h(ev.data as never)
  }
  return { socket, emit }
}

describe("notebook queries", () => {
  it("reads the live and a saved notebook", async () => {
    const m = mockFetch((c) =>
      c.url === "/api/session/notebook" ? notebook() : notebook({ session_id: "old" }),
    )
    const live = renderHook(() => useNotebook(), { wrapper })
    const saved = renderHook(() => useSessionNotebook("old"), { wrapper })
    await waitFor(() => expect(saved.result.current.data?.session_id).toBe("old"))
    await waitFor(() => expect(live.result.current.data?.session_id).toBe("s1"))
    expect(m.calls.map((c) => c.url).sort()).toEqual(["/api/session/notebook", "/api/sessions/old/notebook"])
  })

  it("keeps an item at once and rolls back when the server refuses", async () => {
    client.setQueryData(keys.notebook(), notebook())
    mockFetch(() => httpError(404, "not found"))
    const { result } = renderHook(() => useSetNotebookStatus(), { wrapper })
    act(() => result.current.mutate({ id: "i1", status: "kept" }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData<Notebook>(keys.notebook())!.items[0]!.status).toBe("open")
  })

  it("shows the new status before the server answers", async () => {
    client.setQueryData(keys.notebook(), notebook())
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const m = mockFetch(async (c) => {
      await gate
      return item({ status: bodyOf<{ status: "kept" }>(c).status })
    })
    const { result } = renderHook(() => useSetNotebookStatus(), { wrapper })
    act(() => result.current.mutate({ id: "i1", status: "kept" }))
    await waitFor(() => expect(client.getQueryData<Notebook>(keys.notebook())!.items[0]!.status).toBe("kept"))
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(m.calls[0]!.url).toBe("/api/session/notebook/i1")
  })

  it("adds a pin at once, keeps one copy, and rolls back on error", async () => {
    client.setQueryData(keys.notebook(), notebook())
    const real = { id: "p1", t: 5, text: "ask", created_at: 1 }
    mockFetch(() => real)
    const { result } = renderHook(() => useAddPin(), { wrapper })
    act(() => result.current.mutate({ t: 5, text: "ask" }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<Notebook>(keys.notebook())!.pins).toEqual([real])

    client.setQueryData(keys.notebook(), notebook())
    mockFetch(() => httpError(400, "no session is running"))
    const failing = renderHook(() => useAddPin(), { wrapper })
    act(() => failing.result.current.mutate({ t: 5, text: "ask" }))
    await waitFor(() => expect(failing.result.current.isError).toBe(true))
    expect(client.getQueryData<Notebook>(keys.notebook())!.pins).toEqual([])
  })
})

describe("bridgeSocket and the notebook", () => {
  it("replaces the cached notebook on notebook.updated", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    client.setQueryData(keys.notebook(), notebook())
    emit({ type: "notebook.updated", data: notebook({ updating: true, items: [] }) })
    expect(client.getQueryData<Notebook>(keys.notebook())).toMatchObject({ updating: true, items: [] })
  })

  it("refetches the notebook after a snapshot", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    client.setQueryData(keys.notebook(), notebook())
    const spy = vi.spyOn(client, "invalidateQueries")
    emit({ type: "snapshot", data: snapshot() })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.notebook(), exact: true })
  })
})
