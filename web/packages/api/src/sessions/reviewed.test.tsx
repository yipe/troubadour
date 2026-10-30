import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { makeQueryClient } from "../query/client.ts"
import { keys } from "../query/keys.ts"
import { mockFetch, savedSession } from "../testing/index.ts"
import { useMarkReviewed, useSessions } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("useMarkReviewed refetches the session list", async () => {
  const client = makeQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  let reviewed_at: number | null = null
  mockFetch((call) => {
    if (call.method === "POST") {
      reviewed_at = 9
      return { id: "a", reviewed_at }
    }
    return [savedSession({ id: "a", reviewed_at })]
  })
  const { result } = renderHook(() => ({ list: useSessions(), mark: useMarkReviewed("a") }), { wrapper })
  await waitFor(() => expect(result.current.list.data?.[0]?.reviewed_at).toBeNull())
  await act(() => result.current.mark.mutateAsync(true))
  await waitFor(() =>
    expect(client.getQueryData<{ reviewed_at: number | null }[]>(keys.sessions())?.[0]?.reviewed_at).toBe(9),
  )
})
