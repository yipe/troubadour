import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { forwardRef, type ComponentProps } from "react"
import { VirtuosoMockContext, type VirtuosoHandle } from "react-virtuoso"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applySpeaker, resetLive } from "@troubadour/api/live"
import { keys } from "@troubadour/api/query"
import {
  answerSource,
  bodyOf,
  campaign,
  campaignAnswer,
  message,
  mockFetch,
  player,
  savedSession,
  session,
  voice,
} from "@troubadour/api/testing"
import { Toaster } from "@troubadour/ui/toast"
import { renderWithProviders } from "../../../test/render.tsx"
import { LiveTranscript } from "./LiveTranscript.tsx"

// `initialTopMostItemIndex` waits for real layout, which jsdom lacks, and then renders no rows.
vi.mock("react-virtuoso", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-virtuoso")>()
  const Virtuoso = forwardRef<VirtuosoHandle, ComponentProps<typeof mod.Virtuoso>>(
    function Virtuoso(props, ref) {
      return <mod.Virtuoso {...props} ref={ref} initialTopMostItemIndex={undefined} />
    },
  )
  return { ...mod, Virtuoso }
})

const PLAYERS = [
  player({ id: "gm", name: "Alex", is_gm: true }),
  player({ id: "p1", name: "Maya", character: "Velis" }),
]
const VOICES = [
  voice({ id: "v1", status: "named", player_id: "gm" }),
  voice({ id: "v2", status: "named", player_id: "p1" }),
]
const MESSAGES = [
  message({ id: "a", voice_id: "v1", t_start: 10, t_end: 20, text: "The door is locked." }),
  message({ id: "b", voice_id: "v2", t_start: 30, t_end: 40, text: "I pick the lock." }),
  message({ id: "c", voice_id: "v2", t_start: 60, t_end: 70, text: "We go in." }),
]

afterEach(() => {
  applySpeaker(null)
  resetLive()
  vi.restoreAllMocks()
})

function setup(
  props: { highlightT?: number | null; onPinned?: () => void } = {},
  handlers: Parameters<typeof mockFetch>[0] = () => undefined,
) {
  const onPinned = props.onPinned ?? vi.fn()
  const fetchMock = mockFetch((c) => {
    if (c.url === "/api/classes") return []
    return handlers(c)
  })
  const utils = renderWithProviders(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 40 }}>
      <LiveTranscript highlightT={props.highlightT ?? null} onPinned={onPinned} />
      <Toaster />
    </VirtuosoMockContext.Provider>,
    {
      live: { session: session({ t: 75 }), players: PLAYERS, voices: VOICES, messages: MESSAGES },
      queryData: [
        [keys.campaign(), campaign()],
        [
          keys.sessions(),
          [savedSession({ id: "old", started_at: 1 }), savedSession({ id: "now", started_at: 2 })],
        ],
      ],
    },
  )
  return { ...utils, fetchMock, onPinned }
}

const bar = () => screen.getByRole("textbox", { name: /Ask a question/ })
const type = (text: string) => {
  fireEvent.change(bar(), { target: { value: text } })
  fireEvent.keyDown(bar(), { key: "Enter" })
}
const lineEl = (container: HTMLElement, id: string) => container.querySelector(`[data-line-id="${id}"]`)!

describe("LiveTranscript", () => {
  it("shows the lines, and who is speaking under them", () => {
    const { container } = setup()
    expect(lineEl(container, "a")).toHaveTextContent("The door is locked.")
    act(() => applySpeaker("v2"))
    expect(screen.getByText("Maya is speaking…")).toBeInTheDocument()
  })

  it("highlights the line a moment falls in", () => {
    const { container } = setup({ highlightT: 35 })
    expect(lineEl(container, "b")).toHaveAttribute("aria-current", "true")
    expect(lineEl(container, "a")).not.toHaveAttribute("aria-current")
  })

  it("a question calls ask with the session time", async () => {
    const { fetchMock } = setup({}, (c) =>
      c.url === "/api/campaign/ask"
        ? campaignAnswer({ id: "q1", state: "searching", question: "Who locked it?" })
        : undefined,
    )
    type("Who locked it?")
    expect(await screen.findByText("Searching…")).toBeInTheDocument()
    const call = fetchMock.writes().find((c) => c.url === "/api/campaign/ask")!
    expect(bodyOf<{ question: string; t: number }>(call)).toMatchObject({ question: "Who locked it?" })
    expect(bodyOf<{ t: number }>(call).t).toBeGreaterThanOrEqual(75)
    expect(bar()).toHaveValue("")
  })

  it("a note pins at the current time, toasts and tells the page", async () => {
    const { fetchMock, onPinned } = setup({}, (c) =>
      c.url === "/api/session/pins"
        ? { id: "p1", t: 75, text: "Ask about the key", created_at: 1 }
        : undefined,
    )
    type("Ask about the key")
    expect(onPinned).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/^Pinned at 1:1\d$/)).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.writes().some((c) => c.url === "/api/session/pins")).toBe(true))
    expect(fetchMock.writes().some((c) => c.url === "/api/campaign/ask")).toBe(false)
  })

  it("Esc closes the answer, and the close button does too", async () => {
    setup({}, () => campaignAnswer({ id: "q1", state: "searching", question: "Who?" }))
    type("Who?")
    const panel = await screen.findByRole("region", { name: "Answer" })
    fireEvent.keyDown(bar(), { key: "Escape" })
    expect(panel).not.toBeInTheDocument()

    type("Who again?")
    fireEvent.click(await screen.findByRole("button", { name: "Close answer" }))
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull()
  })

  it("a source from tonight highlights its line; another session's does not", async () => {
    const answer = campaignAnswer({
      id: "q1",
      question: "Who?",
      answer: "Alex [S1], earlier [S2].",
      sources: [
        answerSource({
          id: "S1",
          kind: "transcript",
          label: "Alex · Session 2 · 0:30",
          session: "now",
          t: 35,
          excerpt: "x",
        }),
        answerSource({
          id: "S2",
          kind: "transcript",
          label: "Alex · Session 1 · 0:30",
          session: "old",
          t: 35,
          excerpt: "y",
        }),
      ],
    })
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
    const { container } = setup({}, (c) => (c.url === "/api/campaign/ask" ? answer : undefined))
    type("Who?")
    const sources = await screen.findByRole("list", { name: "Sources" })
    expect(lineEl(container, "b")).not.toHaveAttribute("aria-current")
    fireEvent.click(within(sources).getAllByRole("button", { name: /Play line/ })[0]!)
    await waitFor(() => expect(lineEl(container, "b")).toHaveAttribute("aria-current", "true"))
  })

  it("clicking a speaker offers the players and reassigns that one line", async () => {
    const { fetchMock } = setup({}, (c) =>
      c.url === "/api/messages/a/speaker" ? { message: MESSAGES[0], voice: VOICES[1] } : undefined,
    )
    fireEvent.click(within(lineEl(document.body, "a") as HTMLElement).getByRole("button", { name: "Alex" }))
    expect(await screen.findByText("Who said this line?")).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/As a character/), { target: { value: "Choir" } })
    fireEvent.click(await screen.findByRole("button", { name: /Maya as Choir/ }))
    await waitFor(() => expect(fetchMock.writes()).toHaveLength(1))
    expect(fetchMock.writes()[0]).toMatchObject({ url: "/api/messages/a/speaker" })
    expect(bodyOf(fetchMock.writes()[0]!)).toEqual({ player_id: "p1", character: "Choir" })
    await waitFor(() => expect(screen.queryByText("Who said this line?")).toBeNull())
  })

  it("offers characters someone already voices", () => {
    const voices = [
      ...VOICES,
      voice({ id: "v3", status: "named", player_id: "gm", character: "Choir voice" }),
    ]
    render(<span />)
    resetLive()
    const { container } = renderWithProviders(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 40 }}>
        <LiveTranscript highlightT={null} onPinned={() => {}} />
      </VirtuosoMockContext.Provider>,
      { live: { session: session(), players: PLAYERS, voices, messages: MESSAGES } },
    )
    fireEvent.click(within(lineEl(container, "a") as HTMLElement).getByRole("button", { name: "Alex" }))
    expect(screen.getByRole("button", { name: /Alex as Choir voice/ })).toBeInTheDocument()
  })
})
