import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes, useLocation } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { campaign, mockFetch, savedSession, sessionRecord } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as SessionsPage } from "./index.tsx"

const notify = vi.hoisted(() => vi.fn())
vi.mock("@troubadour/ui/toast", () => ({ notify, Toaster: () => null }))

afterEach(() => {
  vi.restoreAllMocks()
  notify.mockClear()
})

const s1 = savedSession({ id: "s1", n: 1, started_at: 1_760_000_000, title: "Bells", duration_s: 3600 })
const s2 = savedSession({ id: "s2", n: 2, started_at: 1_760_700_000, title: "Abbey", duration_s: 7200 })
const blip = savedSession({ id: "s3", n: 3, started_at: 1_761_400_000, title: "Oops", duration_s: 3 })
const blip2 = savedSession({ id: "s4", n: 4, started_at: 1_761_500_000, title: "Test", duration_s: 20 })

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function page(route: string, rows = [blip, s2, s1]) {
  const m = mockFetch((c) => {
    if (c.method === "DELETE") return new Response(null, { status: 204 })
    if (c.url === "/api/sessions/upgrades") return { sessions: [], current: {} }
    return c.method === "GET" && c.url === "/api/sessions" ? rows : s1
  })
  renderWithProviders(
    <>
      <Routes>
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<SessionsPage />} />
      </Routes>
      <Where />
    </>,
    {
      route,
      queryData: [
        [keys.sessions(), rows],
        [keys.campaign(), campaign({})],
        ...rows.map((s): [readonly string[], unknown] => [keys.record(s.id), sessionRecord({ id: s.id })]),
      ],
    },
  )
  return m
}

it("deletes from the detail header menu after a confirm, then offers Undo", async () => {
  const m = page("/sessions/s2")
  expect(screen.queryByRole("button", { name: "Merge with another session" })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole("button", { name: "More for this session" }))
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }))
  expect(screen.getByText(/The write-up note in your vault stays/)).toBeInTheDocument()
  expect(m.writes()).toEqual([])
  await userEvent.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    expect(m.writes()).toEqual([{ method: "DELETE", url: "/api/sessions/s2", body: undefined }]),
  )
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/sessions$/))
  expect(notify).toHaveBeenCalledWith(
    "Session deleted",
    expect.objectContaining({ undo: expect.any(Function) }),
  )
  notify.mock.calls[0]![1].undo()
  await waitFor(() =>
    expect(m.writes().at(-1)).toMatchObject({ method: "POST", url: "/api/sessions/s2/undelete" }),
  )
})

it("merging from the header menu opens the dialog", async () => {
  page("/sessions/s2")
  await userEvent.click(await screen.findByRole("button", { name: "More for this session" }))
  await userEvent.click(await screen.findByRole("menuitem", { name: "Merge with…" }))
  expect(await screen.findByText("Merge with another session")).toBeInTheDocument()
})

it("flags very short sessions and deletes them all with one confirm", async () => {
  const m = page("/sessions", [blip2, blip, s2, s1])
  const list = within(screen.getByRole("navigation", { name: "Saved sessions" }))
  expect(list.getAllByText("Very short")).toHaveLength(2)
  expect(screen.getByText("2 sessions are under a minute.")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Review" }))
  expect(list.getAllByRole("link")).toHaveLength(2)
  await userEvent.click(screen.getByRole("button", { name: "Show all" }))
  expect(list.getAllByRole("link")).toHaveLength(4)

  await userEvent.click(screen.getByRole("button", { name: "Delete them…" }))
  await userEvent.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    expect(m.writes().map((w) => [w.method, w.url])).toEqual([
      ["DELETE", "/api/sessions/s4"],
      ["DELETE", "/api/sessions/s3"],
    ]),
  )
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith("2 sessions deleted", expect.anything())
})

it("a row's menu merges with its neighbour: the dialog opens with that session picked", async () => {
  page("/sessions")
  await userEvent.click(screen.getByRole("button", { name: "More for Abbey" }))
  await userEvent.click(await screen.findByRole("menuitem", { name: "Merge with previous" }))
  expect(screen.getByRole("radio", { name: /Bells/ })).toBeChecked()
  expect(screen.getByRole("radio", { name: /Oops/ })).not.toBeChecked()
})

it("a row's menu deletes just that session", async () => {
  const m = page("/sessions")
  await userEvent.click(screen.getByRole("button", { name: "More for Bells" }))
  expect(screen.queryByRole("menuitem", { name: "Merge with previous" })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }))
  await userEvent.click(screen.getByRole("button", { name: "Delete" }))
  await waitFor(() =>
    expect(m.writes()).toEqual([{ method: "DELETE", url: "/api/sessions/s1", body: undefined }]),
  )
})
