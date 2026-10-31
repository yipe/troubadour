import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import {
  campaign,
  bodyOf,
  campaignJob,
  entity,
  factSuggestion,
  mockFetch,
  savedSession,
  sessionRecord,
} from "@troubadour/api/testing"
import { Route, Routes, useLocation } from "react-router"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as SessionsPage } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const s1 = savedSession({ id: "s1", n: 1, started_at: 1_760_000_000, title: "Bells", duration_s: 3600 })
const s2 = savedSession({
  id: "s2",
  n: 2,
  started_at: 1_760_700_000,
  title: "The Abbey",
  duration_s: 7200,
  lines: 1284,
  summary: "The party reached the abbey.",
  scenes: [
    { t: 0, title: "Table talk", place: null },
    { t: 840, title: "Haggling", place: null },
  ],
})
const s3 = savedSession({ id: "s3", n: 3, started_at: 1_761_400_000, title: null, duration_s: 600 })
const written = { s1: "Sessions/s1.md", s2: "Sessions/s2.md" }

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function page(route: string, over: Parameters<typeof campaign>[0] = {}) {
  return renderWithProviders(
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
        [keys.sessions(), [s3, s2, { ...s1, reviewed_at: 5 }]],
        [keys.campaign(), campaign({ written_up: written, ...over })],
        ...["s1", "s2", "s3"].map((id): [readonly string[], unknown] => [
          keys.record(id),
          sessionRecord({ id }),
        ]),
      ],
    },
  )
}

it("lists each session with its status and defaults to the newest", async () => {
  page("/sessions")
  const list = within(screen.getByRole("navigation", { name: "Saved sessions" }))
  expect(list.getAllByRole("link")).toHaveLength(3)
  expect(list.getByText("Reviewed")).toBeInTheDocument()
  expect(list.getByText("Needs review")).toBeInTheDocument()
  expect(list.getByText("Not written up")).toBeInTheDocument()
  expect(list.getByText(/^Untitled · /)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Prepare next session/ })).toBeInTheDocument()
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Untitled/)
})

it("selecting a session changes the URL and the detail", async () => {
  page("/sessions")
  await userEvent.click(
    within(screen.getByRole("navigation", { name: "Saved sessions" })).getByText("The Abbey"),
  )
  expect(screen.getByTestId("where")).toHaveTextContent("/sessions/s2")
  expect(await screen.findByRole("heading", { level: 1, name: "The Abbey" })).toBeInTheDocument()
  expect(screen.getByText("The party reached the abbey.")).toBeInTheDocument()
})

it("shows the Review button only when suggestions are open", () => {
  const open = campaign({
    written_up: written,
    entities: [
      entity({
        name: "Orsa",
        suggested_facts: [
          factSuggestion({ text: "a", source: { page: "", label: null, session_id: "s2", t: null } }),
          factSuggestion({ text: "b", source: { page: "", label: null, session_id: "s2", t: null } }),
        ],
      }),
    ],
  })
  const { unmount } = page("/sessions/s2", open)
  expect(screen.getByRole("button", { name: "Review 2 suggestions" })).toHaveAttribute(
    "href",
    "/sessions/s2/review",
  )
  unmount()
  page("/sessions/s2")
  expect(screen.queryByRole("button", { name: /^Review/ })).not.toBeInTheDocument()
})

it("offers the recap once reviewed", () => {
  page("/sessions/s1")
  expect(screen.getByRole("button", { name: "Recap" })).toHaveAttribute("href", "/sessions/s1/recap")
})

it("shows scene lengths from the next scene's start", () => {
  page("/sessions/s2")
  expect(screen.getByText("14 m")).toBeInTheDocument()
  expect(screen.getByText("1 h 46 m")).toBeInTheDocument()
})

it("explains scenes before a write-up and starts the write-up job", async () => {
  const m = mockFetch((c) =>
    c.url === "/api/sessions/upgrades"
      ? { sessions: [], current: {} }
      : campaignJob({ id: "j1", kind: "writeup", title: "s3", state: "queued" }),
  )
  page("/sessions/s3")
  expect(screen.getByText("Scenes appear after the write-up.")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Write up" }))
  await vi.waitFor(() =>
    expect(m.calls).toContainEqual(
      expect.objectContaining({ method: "POST", url: "/api/campaign/writeup/s3" }),
    ),
  )
})

it("offers to improve and write up again on a session that was merged into", async () => {
  const merged = { ...s2, merged_from: ["s9"] }
  renderWithProviders(
    <Routes>
      <Route path="/sessions/:id" element={<SessionsPage />} />
    </Routes>,
    {
      route: "/sessions/s2",
      queryData: [
        [keys.sessions(), [merged, s1]],
        [keys.campaign(), campaign({ written_up: written })],
        [keys.record("s2"), sessionRecord({ id: "s2" })],
      ],
    },
  )
  expect(screen.getByText(/Merged with another session/)).toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: "Improve transcript" })).toHaveLength(2) // the notice and the transcript header
  expect(screen.getByRole("button", { name: "Write up again" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "More for this session" }))
  expect(await screen.findByRole("menuitem", { name: "Improve transcript…" })).toBeInTheDocument()
  expect(screen.getByRole("menuitem", { name: "Write up again" })).toBeInTheDocument()
})

it("badges a notes session, offers no merge for it, and adds session notes from the list", async () => {
  const notes = savedSession({ id: "n1", kind: "notes", n: 1, started_at: 1_759_000_000, title: "Bells" })
  const api = mockFetch((c) =>
    c.url === "/api/sessions/notes"
      ? campaignJob({ id: "j9", state: "queued" })
      : c.url === "/api/sessions/upgrades"
        ? { sessions: [], current: {} }
        : [],
  )
  renderWithProviders(
    <Routes>
      <Route path="/sessions" element={<SessionsPage />} />
    </Routes>,
    {
      route: "/sessions",
      queryData: [
        [keys.sessions(), [s2, notes]],
        [keys.campaign(), campaign({ written_up: written })],
        [keys.record("s2"), sessionRecord({ id: "s2" })],
      ],
    },
  )
  expect(
    within(screen.getByRole("navigation", { name: "Saved sessions" })).getByText("Notes"),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /Add session notes/ }))
  fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2026-10-01" } })
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "The Fair" } })
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "We went to the fair." } })
  await userEvent.click(screen.getByRole("button", { name: "Add session" }))
  await waitFor(() => expect(api.writes()).toHaveLength(1))
  expect(api.writes()[0]).toMatchObject({ url: "/api/sessions/notes" })
  expect(bodyOf(api.writes()[0]!)).toEqual({
    date: "2026-10-01",
    title: "The Fair",
    text: "We went to the fair.",
  })
})
