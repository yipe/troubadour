import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAddCampaignFact, useCampaign, useIgnoreWord, useMutateEntity } from "../campaign/index.ts"
import { bridgeSocket, REFETCH_DEBOUNCE_MS } from "./bridge.ts"
import { makeQueryClient } from "./client.ts"
import { keys } from "./keys.ts"
import type { Campaign, CampaignSuggestions, Entity, EntityPatch } from "../campaign/types.ts"
import type { ServerEvent } from "../events/index.ts"
import type { Socket } from "../socket/index.ts"
import {
  bodyOf,
  campaign,
  campaignJob,
  entity,
  fact,
  httpError,
  mockFetch,
  session,
  snapshot,
} from "../testing/index.ts"

let client: QueryClient
beforeEach(() => {
  client = makeQueryClient()
})
afterEach(() => vi.restoreAllMocks())

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

/** A server holding one list of entities; PATCH applies the body and answers with the entry. */
function entityServer(initial: Entity[], gate?: Promise<void>) {
  const entities = new Map(initial.map((e) => [e.name, e]))
  let patches = 0
  const m = mockFetch(async (call) => {
    if (call.method === "GET" && call.url === "/api/campaign")
      return campaign({ entities: [...entities.values()] })
    if (call.method === "PATCH") {
      if (patches++ === 0) await gate
      const name = decodeURIComponent(call.url.split("/").pop()!)
      const e = { ...entities.get(name)!, ...bodyOf<EntityPatch>(call) } as Entity
      entities.set(name, e)
      return e
    }
    return undefined
  })
  return m
}

describe("campaignWrite", () => {
  it("runs two writes one after another, the second built from the first's response", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const m = entityServer([entity({ name: "Elara", aliases: [] })], gate)
    client.setQueryData(keys.campaign(), campaign({ entities: [entity({ name: "Elara", aliases: [] })] }))
    const { result } = renderHook(() => useMutateEntity(), { wrapper })

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.mutateAsync({
        name: "Elara",
        change: (e) => ({ aliases: [...e.aliases, "El"] }),
      })
      second = result.current.mutateAsync({
        name: "Elara",
        change: (e) => ({ aliases: [...e.aliases, "Ela"] }),
      })
    })
    await vi.waitFor(() => expect(m.writes()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(m.writes()).toHaveLength(1) // the second hasn't started while the first is out
    release()
    await Promise.all([first, second])

    expect(m.writes().map((c) => bodyOf<EntityPatch>(c).aliases)).toEqual([["El"], ["El", "Ela"]])
    expect(client.getQueryData<Campaign>(keys.campaign())!.entities[0]!.aliases).toEqual(["El", "Ela"])
  })

  it("an error doesn't block the next write", async () => {
    let n = 0
    const m = mockFetch((call) => {
      if (call.method === "POST" && n++ === 0) return httpError(500, "boom")
      return [fact({ text: "a fact" })]
    })
    const { result } = renderHook(() => useAddCampaignFact(), { wrapper })
    let failed!: Promise<unknown>
    let ok!: Promise<unknown>
    act(() => {
      failed = result.current.mutateAsync({ text: "one" }).catch((e: Error) => e.message)
      ok = result.current.mutateAsync({ text: "two" })
    })
    expect(await failed).toBe("boom")
    expect(await ok).toEqual([fact({ text: "a fact" })])
    expect(m.writes()).toHaveLength(2)
  })

  it("a campaign fetch waits for queued writes and keeps the state they left", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    entityServer([entity({ name: "Elara" })], gate)
    const { result } = renderHook(() => ({ q: useCampaign(), w: useMutateEntity() }), { wrapper })
    await waitFor(() => expect(result.current.q.data).toBeDefined())
    act(() => {
      void result.current.w.mutateAsync({ name: "Elara", change: () => ({ description: "new" }) })
    })
    act(() => void client.invalidateQueries({ queryKey: keys.campaign() }))
    release()
    await waitFor(() =>
      expect(client.getQueryData<Campaign>(keys.campaign())!.entities[0]!.description).toBe("new"),
    )
  })

  it("ignoring a word hides its row at once and puts it back on error", async () => {
    const rows: CampaignSuggestions = {
      misheard: [],
      unknown: [{ heard: "Zorp", count: 2, example: "x" }],
    }
    client.setQueryData(keys.suggestions(), rows)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    mockFetch(async () => {
      await gate
      return httpError(500, "nope")
    })
    const { result } = renderHook(() => useIgnoreWord(), { wrapper })
    let p!: Promise<unknown>
    act(() => {
      p = result.current.mutateAsync("Zorp").catch(() => undefined)
    })
    await vi.waitFor(() =>
      expect(client.getQueryData<CampaignSuggestions>(keys.suggestions())!.unknown).toEqual([]),
    )
    release()
    await p
    expect(client.getQueryData<CampaignSuggestions>(keys.suggestions())!.unknown).toHaveLength(1)
  })
})

describe("useCampaign", () => {
  it("loads the campaign", async () => {
    mockFetch(() => campaign({ facts: [fact({ text: "The king is dead" })] }))
    const { result } = renderHook(() => useCampaign(), { wrapper })
    await waitFor(() => expect(result.current.data?.facts.map((f) => f.text)).toEqual(["The king is dead"]))
  })

  it("keeps a job that already ended when an older fetch says it is running", async () => {
    client.setQueryData(keys.campaign(), campaign({ jobs: [campaignJob({ id: "j", state: "done" })] }))
    mockFetch(() => campaign({ jobs: [campaignJob({ id: "j", state: "running" })] }))
    const { result } = renderHook(() => useCampaign(), { wrapper })
    await act(() => result.current.refetch())
    expect(result.current.data!.jobs[0]!.state).toBe("done")
  })
})

describe("bridgeSocket", () => {
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

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("patches campaign.job into the cached campaign, by id", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    client.setQueryData(keys.campaign(), campaign({ jobs: [campaignJob({ id: "a" })] }))
    emit({ type: "campaign.job", data: campaignJob({ id: "a", state: "running", done: 3 }) })
    emit({ type: "campaign.job", data: campaignJob({ id: "b" }) })
    const jobs = client.getQueryData<Campaign>(keys.campaign())!.jobs
    expect(jobs.map((j) => [j.id, j.state])).toEqual([
      ["a", "running"],
      ["b", "queued"],
    ])
  })

  it("invalidates campaign and suggestions once for three events within 300 ms", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    const spy = vi.spyOn(client, "invalidateQueries")
    for (let i = 0; i < 3; i++) {
      emit({ type: "campaign.updated", data: {} })
      vi.advanceTimersByTime(100)
    }
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REFETCH_DEBOUNCE_MS)
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([keys.campaign(), keys.suggestions()])
  })

  it("invalidates sessions when the live session goes from running to idle", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    const spy = vi.spyOn(client, "invalidateQueries")
    emit({ type: "snapshot", data: snapshot({ session: session({ status: "running" }) }) })
    spy.mockClear() // the snapshot's own notebook refetch
    emit({ type: "session.updated", data: session({ status: "running" }) })
    expect(spy).not.toHaveBeenCalled()
    emit({ type: "session.updated", data: session({ status: "idle" }) })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]?.queryKey).toEqual(keys.sessions())
  })

  it("a snapshot of another campaign invalidates everything but live-only keys", () => {
    const { socket, emit } = fakeSocket()
    const onCampaignSwitch = vi.fn()
    bridgeSocket(socket, client, { onCampaignSwitch })
    client.setQueryData(keys.sessions(), [])
    client.setQueryData(keys.mics(), [])
    emit({ type: "snapshot", data: snapshot() })
    expect(client.getQueryState(keys.sessions())!.isInvalidated).toBe(false) // first snapshot: no switch
    emit({ type: "snapshot", data: snapshot() })
    expect(client.getQueryState(keys.sessions())!.isInvalidated).toBe(false) // reconnect, same campaign
    expect(onCampaignSwitch).not.toHaveBeenCalled()
    emit({
      type: "snapshot",
      data: snapshot({ campaign: "other", campaigns: [{ id: "other", name: "Other" }] }),
    })
    expect(client.getQueryState(keys.sessions())!.isInvalidated).toBe(true)
    expect(client.getQueryState(keys.mics())!.isInvalidated).toBe(false)
    expect(onCampaignSwitch).toHaveBeenCalledWith("other")
    expect(client.getQueryData(keys.campaigns())).toMatchObject({ campaign: "other" })
  })

  it("sets cloud, llm and campaigns from their events", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    const campaigns = { campaign: "a", campaigns: [{ id: "a", name: "A" }] }
    emit({ type: "campaigns.updated", data: campaigns })
    emit({ type: "llm.updated", data: { provider: "local", providers: [] } })
    expect(client.getQueryData(keys.campaigns())).toEqual(campaigns)
    expect(client.getQueryData(keys.llm())).toEqual({ provider: "local", providers: [] })
  })

  it("refetches clones when a clone job ends", () => {
    const { socket, emit } = fakeSocket()
    bridgeSocket(socket, client)
    const spy = vi.spyOn(client, "invalidateQueries")
    emit({ type: "campaign.job", data: campaignJob({ id: "c", kind: "clone", state: "running" }) })
    expect(spy).not.toHaveBeenCalled()
    emit({ type: "campaign.job", data: campaignJob({ id: "c", kind: "clone", state: "done" }) })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.clones() })
  })
})
