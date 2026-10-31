import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { expect, it } from "vitest"
import { makeQueryClient } from "../query/client.ts"
import { keys } from "../query/keys.ts"
import { useCampaigns } from "./index.ts"

it("a refetch of the cache-only list keeps the list instead of erroring", async () => {
  const client = makeQueryClient()
  const list = { campaign: "a", campaigns: [{ id: "a", name: "A", table_name: "" }] }
  client.setQueryData(keys.campaigns(), list)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useCampaigns(), { wrapper })
  await act(() => client.invalidateQueries({ queryKey: keys.campaigns() }))
  expect(result.current.isError).toBe(false)
  expect(result.current.data).toEqual(list)
})
