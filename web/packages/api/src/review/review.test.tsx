import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { makeQueryClient } from "../query/client.ts"
import { keys } from "../query/keys.ts"
import { bodyOf, httpError, mockFetch } from "../testing/index.ts"
import { useReview, useReviewAction } from "./queries.ts"
import type { Review, ReviewItem } from "./types.ts"

let client: QueryClient
beforeEach(() => {
  client = makeQueryClient()
})
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const entry = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "entry:abc",
  kind: "entry",
  line_id: "m1",
  t: 10,
  status: "open",
  preaccepted: false,
  fact: null,
  spelling: null,
  entry: { name: "Mudge", type: "npc", description: "An ogre." },
  ...over,
})
const review = (items: ReviewItem[]): Review => ({
  session_id: "s1",
  written_up: true,
  items,
  counts: { total: items.length, done: 0, fact: 0, spelling: 0, entry: items.length },
})

describe("review hooks", () => {
  it("reads a session's review", async () => {
    const fetchMock = mockFetch(() => review([entry()]))
    const { result } = renderHook(() => useReview("s1"), { wrapper })
    await waitFor(() => expect(result.current.data?.counts.total).toBe(1))
    expect(fetchMock.calls[0]?.url).toBe("/api/sessions/s1/review")
  })

  it("stores the returned item and the new counts, and refetches the campaign", async () => {
    const other = entry({ id: "entry:def" })
    client.setQueryData(keys.review("s1"), review([entry(), other]))
    client.setQueryData(keys.campaign(), { entities: [] })
    const fetchMock = mockFetch((c) =>
      c.method === "POST" ? entry({ status: "accepted" }) : { entities: [] },
    )
    const { result } = renderHook(() => useReviewAction("s1"), { wrapper })
    await act(() => result.current.mutateAsync({ itemId: "entry:abc", action: "accept" }))
    const cached = client.getQueryData<Review>(keys.review("s1"))
    expect(cached?.items.map((i) => i.status)).toEqual(["accepted", "open"])
    expect(cached?.counts).toMatchObject({ total: 2, done: 1 })
    expect(fetchMock.calls[0]?.url).toBe("/api/sessions/s1/review/entry%3Aabc")
    expect(bodyOf(fetchMock.calls[0]!)).toEqual({ action: "accept" })
    expect(client.getQueryState(keys.campaign())?.isInvalidated).toBe(true)
  })

  it("sends a moved fact's null `about` and an edited text", async () => {
    client.setQueryData(keys.review("s1"), review([entry()]))
    const fetchMock = mockFetch((c) =>
      c.method === "POST" ? entry({ status: "accepted" }) : { entities: [] },
    )
    const { result } = renderHook(() => useReviewAction("s1"), { wrapper })
    await act(() =>
      result.current.mutateAsync({ itemId: "entry:abc", action: "accept", text: "New", about: null }),
    )
    expect(bodyOf(fetchMock.calls[0]!)).toEqual({ action: "accept", text: "New", about: null })
  })

  it("refetches the review when the item was already decided (409)", async () => {
    let gets = 0
    mockFetch((c) => {
      if (c.method === "POST") return httpError(409, "That item was already decided.")
      return review([entry({ status: gets++ === 0 ? "open" : "rejected" })])
    })
    const { result } = renderHook(() => useReview("s1"), { wrapper })
    const action = renderHook(() => useReviewAction("s1"), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    await act(async () => {
      await action.result.current
        .mutateAsync({ itemId: "entry:abc", action: "accept" })
        .catch(() => undefined)
    })
    await waitFor(() => expect(result.current.data?.items[0]?.status).toBe("rejected"))
  })
})
