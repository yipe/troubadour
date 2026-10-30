import { QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { expect, it } from "vitest"
import { makeQueryClient } from "../query/client.ts"
import { bodyOf, mockFetch } from "../testing/index.ts"
import { useBuildRecap, useRecap } from "./queries.ts"
import type { Recap, RecapOptions } from "./types.ts"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
)

const options: RecapOptions = {
  voice: "bullets",
  length_s: 30,
  include: { happened: true, quote: false, moments: true, questions: false },
}
const recap: Recap = {
  title: "Beneath the tide",
  body: "- One\n- Two\n- Three",
  quote: null,
  moments: [{ player_id: "p1", text: "Cracked the riddle" }],
  questions: [],
  options,
  built_at: 5,
}

it("useRecap reads the stored recap, or null", async () => {
  const m = mockFetch(() => recap)
  const { result } = renderHook(() => useRecap("s 1"), { wrapper })
  await waitFor(() => expect(result.current.data).toEqual(recap))
  expect(m.calls[0]).toMatchObject({ method: "GET", url: "/api/sessions/s%201/recap" })

  mockFetch(() => null)
  const none = renderHook(() => useRecap("s2"), { wrapper })
  await waitFor(() => expect(none.result.current.isSuccess).toBe(true))
  expect(none.result.current.data).toBeNull()
})

it("useBuildRecap POSTs the options", async () => {
  const job = { id: "j1", kind: "recap", title: "s1", state: "queued", done: 0, total: 0, message: "" }
  const m = mockFetch(() => job)
  const { result } = renderHook(() => useBuildRecap("s1"), { wrapper })
  result.current.mutate(options)
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/sessions/s1/recap" })
  expect(bodyOf(m.calls[0]!)).toEqual(options)
})
