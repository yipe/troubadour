import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { makeQueryClient } from "../query/client.ts"
import { keys } from "../query/keys.ts"
import { bodyOf, campaign, entity, fact, factSuggestion, mockFetch } from "../testing/index.ts"
import {
  addCampaignFact,
  addEntityFact,
  deleteCampaignFact,
  deleteEntityFact,
  editEntityFact,
  useDeleteFact,
  useEditFact,
  useReviewFact,
} from "./index.ts"
import type { Campaign } from "./types.ts"

afterEach(() => vi.restoreAllMocks())

it("addEntityFact POSTs the fact to the escaped entity name", async () => {
  const m = mockFetch(() => entity({ name: "Elara Vance" }))
  await addEntityFact("Elara Vance", { text: "Owns a ship", confidence: "gm", said_by: "Alex" })
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/campaign/entities/Elara%20Vance/facts" })
  expect(bodyOf(m.calls[0]!)).toEqual({ text: "Owns a ship", confidence: "gm", said_by: "Alex" })
})

it("facts are edited and deleted by id", async () => {
  const m = mockFetch(() => entity({ name: "Elara" }))
  await editEntityFact("Elara", { fact_id: "abc", text: "Owns two ships", as_update: true })
  await deleteEntityFact("Elara", "abc")
  expect(m.calls[0]).toMatchObject({ method: "PATCH", url: "/api/campaign/entities/Elara/facts" })
  expect(bodyOf(m.calls[0]!)).toEqual({ fact_id: "abc", text: "Owns two ships", as_update: true })
  expect(m.calls[1]).toMatchObject({ method: "DELETE", url: "/api/campaign/entities/Elara/facts/abc" })
})

it("campaign facts use the same shapes", async () => {
  const m = mockFetch(() => [])
  await addCampaignFact({ text: "Two bells mark the tide." })
  await deleteCampaignFact("abc")
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/campaign/facts" })
  expect(m.calls[1]).toMatchObject({ method: "DELETE", url: "/api/campaign/facts/abc" })
})

function setup(initial: Campaign) {
  const client = makeQueryClient()
  client.setQueryData(keys.campaign(), initial)
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

it("useReviewFact sends the suggestion's id, and skips one that is already decided", async () => {
  const elara = entity({
    name: "Elara",
    suggested_facts: [factSuggestion({ id: "s1", text: "Has an owl." })],
  })
  const { client, wrapper } = setup(campaign({ entities: [elara] }))
  const m = mockFetch(() => entity({ name: "Elara", facts: [fact({ id: "s1", text: "Has an owl." })] }))
  const { result } = renderHook(() => useReviewFact(), { wrapper })

  await act(() => result.current.mutateAsync({ name: "Elara", factId: "s1", accept: true }))
  expect(bodyOf(m.calls[0]!)).toEqual({ accept_facts: ["s1"] })
  expect(client.getQueryData<Campaign>(keys.campaign())!.entities[0]!.facts.map((f) => f.id)).toEqual(["s1"])

  const again = await act(() => result.current.mutateAsync({ name: "Elara", factId: "s1", accept: false }))
  expect(again).toBeUndefined() // gone from the suggestions: nothing sent
  expect(m.calls).toHaveLength(1)
})

it("useEditFact and useDeleteFact skip a fact that is no longer there", async () => {
  const elara = entity({ name: "Elara", facts: [fact({ id: "f1", text: "Has an owl." })] })
  const { wrapper } = setup(campaign({ entities: [elara] }))
  const m = mockFetch(() => entity({ name: "Elara" }))
  const edit = renderHook(() => useEditFact(), { wrapper })
  const del = renderHook(() => useDeleteFact(), { wrapper })

  await act(() => edit.result.current.mutateAsync({ name: "Elara", edit: { fact_id: "gone", text: "x" } }))
  await act(() => del.result.current.mutateAsync({ name: "Elara", factId: "gone" }))
  expect(m.calls).toHaveLength(0)

  await act(() => del.result.current.mutateAsync({ name: "Elara", factId: "f1" }))
  expect(m.calls[0]).toMatchObject({ method: "DELETE", url: "/api/campaign/entities/Elara/facts/f1" })
})
