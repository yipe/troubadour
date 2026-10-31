import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { forwardRef, type ComponentProps } from "react"
import { VirtuosoMockContext, type VirtuosoHandle } from "react-virtuoso"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { mockFetch, recordMessage, savedSession, sessionRecord } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../test/render.tsx"
import { SessionTranscript } from "./SessionTranscript.tsx"

// jsdom has no layout, so `initialTopMostItemIndex` renders no rows; strip it.
vi.mock("react-virtuoso", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-virtuoso")>()
  const Virtuoso = forwardRef<VirtuosoHandle, ComponentProps<typeof mod.Virtuoso>>(
    function Virtuoso(props, ref) {
      return <mod.Virtuoso {...props} ref={ref} initialTopMostItemIndex={undefined} />
    },
  )
  return { ...mod, Virtuoso }
})

afterEach(() => vi.restoreAllMocks())

const record = sessionRecord({
  id: "s1",
  players: [{ id: "p1", name: "Nora", character: "DM", is_gm: true, color: "#10b981" }],
  messages: [
    recordMessage({
      id: "a",
      t_start: 1,
      t_end: 11,
      speaker: "Nora",
      player_id: "p1",
      text: "You enter the cave",
    }),
    recordMessage({
      id: "b",
      t_start: 30,
      t_end: 40,
      speaker: "Nora",
      player_id: "p1",
      text: "A dragon stirs",
    }),
    recordMessage({ id: "c", t_start: 60, t_end: 70, speaker: "Voice 3", text: "I draw my sword" }),
  ],
})

const scrollIntoView = vi.fn()

beforeEach(() => {
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
})

function open(route = "/sessions/s1", audio = true, fail = false) {
  mockFetch((c) =>
    c.url === "/api/sessions/s1/transcript.json"
      ? fail
        ? new Response("nope", { status: 500 })
        : record
      : [],
  )
  return renderWithProviders(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 60 }}>
      <SessionTranscript
        session={savedSession({ id: "s1", title: "The Cave", n: 4, audio })}
        onImprove={() => {}}
      />
    </VirtuosoMockContext.Provider>,
    { route },
  )
}

it("shows the lines under a Transcript heading, with playback for a recorded session", async () => {
  open()
  expect(await screen.findByText("A dragon stirs")).toBeInTheDocument()
  expect(screen.getByRole("region", { name: "Transcript" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Play session audio" })).toBeInTheDocument()
})

it("scrolls itself into view for #transcript or ?t=, and not otherwise", async () => {
  const { unmount } = open("/sessions/s1")
  await screen.findByText("A dragon stirs")
  expect(scrollIntoView).not.toHaveBeenCalled()
  unmount()
  open("/sessions/s1#transcript")
  await screen.findByText("A dragon stirs")
  expect(scrollIntoView).toHaveBeenCalled()
})

it("?t= highlights the line being spoken at that time", async () => {
  const { container } = open("/sessions/s1?t=35")
  await screen.findByText("A dragon stirs")
  await waitFor(() => {
    const current = container.querySelector('[aria-current="true"]') as HTMLElement
    expect(current).not.toBeNull()
    expect(current.dataset.lineId).toBe("b")
  })
})

it("search narrows the lines", async () => {
  open()
  await screen.findByText("A dragon stirs")
  fireEvent.change(screen.getByRole("searchbox", { name: "Search transcript" }), {
    target: { value: "SWORD" },
  })
  await act(async () => {})
  expect(screen.getByText("I draw my sword")).toBeInTheDocument()
  expect(screen.queryByText("A dragon stirs")).toBeNull()
  fireEvent.change(screen.getByRole("searchbox", { name: "Search transcript" }), {
    target: { value: "zzz" },
  })
  expect(await screen.findByText(/No lines match/)).toBeInTheDocument()
})

it("offers no playback for a session without a recording", async () => {
  open("/sessions/s1", false)
  await screen.findByText("A dragon stirs")
  expect(screen.queryByRole("button", { name: "Play session audio" })).toBeNull()
  expect(screen.queryByTitle("Play from here")).toBeNull()
})

it("shows an error when the record can't load", async () => {
  open("/sessions/s1", true, true)
  expect(await screen.findByText("Couldn't load this transcript", {}, { timeout: 4000 })).toBeInTheDocument()
})
