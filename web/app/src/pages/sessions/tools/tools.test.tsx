import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import type { RecordingQuality } from "@troubadour/api/sessions"
import { campaign, campaignJob, mockFetch, savedSession, sessionRecord } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../test/render.tsx"
import { ExportMenu, ImproveDialog, MergeDialog, QualityDialog } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

const ID = "2026-10-08_193401-eebf"

function withJobs(jobs: ReturnType<typeof campaignJob>[]): [readonly string[], unknown] {
  return [keys.campaign(), campaign({ jobs })]
}

describe("ExportMenu", () => {
  it("offers Markdown and JSON, and Audio only when the session has audio", async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<ExportMenu session={savedSession({ id: ID, audio: true })} />)
    await user.click(screen.getByRole("button", { name: /Export/ }))
    expect(await screen.findByRole("menuitem", { name: "Markdown" })).toHaveAttribute(
      "href",
      `/api/sessions/${ID}/transcript.md`,
    )
    expect(screen.getByRole("menuitem", { name: "JSON" })).toHaveAttribute(
      "href",
      `/api/sessions/${ID}/transcript.json`,
    )
    expect(screen.getByRole("menuitem", { name: "Audio (.wav)" })).toHaveAttribute(
      "href",
      `/api/sessions/${ID}/audio.wav`,
    )
    unmount()

    renderWithProviders(<ExportMenu session={savedSession({ id: ID, audio: false })} />)
    await user.click(screen.getByRole("button", { name: /Export/ }))
    await screen.findByRole("menuitem", { name: "JSON" })
    expect(screen.queryByRole("menuitem", { name: /Audio/ })).toBeNull()
  })
})

describe("ImproveDialog", () => {
  const RECORD = `/api/sessions/${ID}/transcript.json`
  const session = savedSession({ id: ID, replayable: true, audio: true })

  function server() {
    return mockFetch((c) => {
      if (c.url === RECORD) return sessionRecord({ id: ID })
      if (c.url.endsWith("/improve"))
        return campaignJob({ id: "i1", kind: "improve", title: ID, state: "queued" })
      if (c.url.endsWith("/spelling"))
        return campaignJob({ id: "s1", kind: "spelling", title: ID, state: "queued" })
      if (c.url.endsWith("/retranscribe"))
        return campaignJob({ id: "r1", kind: "retranscribe", title: ID, state: "queued" })
      if (c.url.endsWith("/in-character"))
        return campaignJob({ id: "c1", kind: "incharacter", title: ID, state: "queued" })
      if (c.url.endsWith("/restore")) return { ok: true }
      return new Response(null, { status: 500 })
    })
  }

  it("hides Improve and Retranscribe without audio, keeps the text-only tools", () => {
    server()
    renderWithProviders(<ImproveDialog session={savedSession({ id: ID })} open />)
    expect(screen.queryByRole("button", { name: "Improve" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Retranscribe" })).toBeNull()
    expect(screen.getByRole("button", { name: "Fix spellings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Estimate" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Restore original" })).toBeNull()
  })

  it("posts the improve job and shows its progress; every button waits for it", async () => {
    const { writes } = server()
    renderWithProviders(<ImproveDialog session={session} open />, {
      queryData: [
        withJobs([
          campaignJob({
            id: "i1",
            kind: "improve",
            title: ID,
            state: "running",
            done: 40,
            total: 2020,
            message: "Paused while a session runs",
          }),
        ]),
      ],
    })
    expect(screen.getByText("Paused while a session runs")).toBeInTheDocument()
    expect(screen.getByText("2%")).toBeInTheDocument()
    for (const name of ["Improve", "Fix spellings", "Estimate", "Retranscribe"])
      expect(screen.getByRole("button", { name })).toBeDisabled()
    expect(writes()).toEqual([])
  })

  it("starts improve, spelling and in-character jobs", async () => {
    const { writes } = server()
    renderWithProviders(<ImproveDialog session={session} open />)
    fireEvent.click(screen.getByRole("button", { name: "Improve" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "POST", url: `/api/sessions/${ID}/improve` })
  })

  it("posts spelling and in-character to their own endpoints", async () => {
    const { writes } = server()
    renderWithProviders(<ImproveDialog session={session} open />)
    fireEvent.click(screen.getByRole("button", { name: "Fix spellings" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]!.url).toBe(`/api/sessions/${ID}/spelling`)
  })

  it("Retranscribe asks first, because hand-fixed speakers can move", async () => {
    const { writes } = server()
    renderWithProviders(<ImproveDialog session={session} open />)
    fireEvent.click(screen.getByRole("button", { name: "Retranscribe" }))
    expect(writes()).toEqual([])
    expect(screen.getByText(/copy of this transcript is saved first/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retranscribe anyway" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]!.url).toBe(`/api/sessions/${ID}/retranscribe`)
  })

  it("Restore original asks first, then posts restore and refetches the record", async () => {
    const { calls, writes } = server()
    renderWithProviders(<ImproveDialog session={{ ...session, restorable: true }} open />)
    fireEvent.click(screen.getByRole("button", { name: "Restore original" }))
    expect(writes()).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]!.url).toBe(`/api/sessions/${ID}/restore`)
    await waitFor(() => expect(calls.filter((c) => c.url === RECORD).length).toBeGreaterThan(1))
  })

  it("shows what each tool did, from the saved record", async () => {
    const r = sessionRecord({ id: ID })
    mockFetch((c) =>
      c.url === RECORD
        ? {
            ...r,
            session: {
              ...r.session,
              improved: { at: 1, model: "large-v3", changed: 143 },
              spelling: { at: 1, fixed: 12 },
              in_character: { at: 1, lines: 4, in_character: 1, by_voice: 0, by_ai: 1, unread: 0 },
              retranscribed: {
                at: 1,
                changed: 122,
                lines: 1595,
                heard_next: 59,
                rematch: 0,
                backup: "t.before.json",
              },
            },
          }
        : new Response(null, { status: 500 }),
    )
    renderWithProviders(<ImproveDialog session={session} open />)
    expect(await screen.findByText("Improved · 143 lines changed")).toBeInTheDocument()
    expect(screen.getByText("Spellings fixed · 12")).toBeInTheDocument()
    expect(screen.getByText("In character · 25% of lines")).toBeInTheDocument()
    expect(
      screen.getByText(/122 of 1595 lines reassigned\. 59 were hearing the next person/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Previous copy: t\.before\.json/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Restore original" })).toBeInTheDocument()
  })

  it("shows a failed job's message", () => {
    server()
    renderWithProviders(<ImproveDialog session={session} open />, {
      queryData: [
        withJobs([
          campaignJob({ id: "s1", kind: "spelling", title: ID, state: "error", message: "LLM offline" }),
        ]),
      ],
    })
    expect(screen.getByRole("alert")).toHaveTextContent("LLM offline")
  })

  it("refetches the record when a job it saw running finishes, but not for an old done job", async () => {
    const { calls } = server()
    const running = campaignJob({ id: "s1", kind: "spelling", title: ID, state: "running" })
    const { client } = renderWithProviders(<ImproveDialog session={session} open />, {
      queryData: [withJobs([running])],
    })
    await waitFor(() => expect(calls.filter((c) => c.url === RECORD)).toHaveLength(1))
    act(() => {
      client.setQueryData(keys.campaign(), campaign({ jobs: [{ ...running, state: "done" }] }))
    })
    await waitFor(() => expect(calls.filter((c) => c.url === RECORD)).toHaveLength(2))
  })
})

describe("QualityDialog", () => {
  const REPORT: RecordingQuality = {
    mic: "Yeti GX",
    overall: {
      speech_db: -36,
      noise_db: -55,
      snr_db: 19,
      rumble_pct: 42,
      clipped_pct: 0,
      grades: { speech: "ok", noise: "ok", snr: "poor", rumble: "ok", clipping: "good" },
    },
    timeline: [0, 60, 120, 180].map((t, i) => ({
      t,
      speech_db: -36 + i,
      noise_db: -55,
      snr_db: 19 + i,
      rumble_pct: [10, 30, 60, 42][i]!,
      clipped_pct: 0,
    })),
    speakers: [
      { speaker: "Theo", level_db: -30, lines: 400 },
      { speaker: "Omar", level_db: -34.2, lines: 120 },
    ],
    spread_db: 4.2,
    verdict: { kind: "microphone", reasons: ["Voices come through quiet.", "Lots of room noise."] },
  }

  it("measures only while open, then shows verdict, numbers, timeline and speaker bars", async () => {
    let answer: (v: unknown) => void = () => {}
    const pending = new Promise((resolve) => (answer = resolve))
    const { calls } = mockFetch(() => pending)
    const session = savedSession({ id: ID, audio: true })
    const closed = renderWithProviders(<QualityDialog session={session} open={false} />)
    expect(calls).toEqual([])
    closed.unmount()
    renderWithProviders(<QualityDialog session={session} open />)
    expect(screen.getByText(/Measuring the recording/)).toBeInTheDocument()
    expect(calls).toEqual([{ method: "GET", url: `/api/sessions/${ID}/quality`, body: undefined }])

    answer(REPORT)
    const banner = await screen.findByRole("status", { name: "" })
    expect(banner).toHaveTextContent("Consider a different microphone")
    expect(within(banner).getAllByRole("listitem")).toHaveLength(2)
    expect(banner).toHaveTextContent("Mic: Yeti GX")
    const snr = document.querySelector<HTMLElement>('[data-quality="snr"]')!
    expect(snr).toHaveTextContent("19 dB")
    expect(within(snr).getByLabelText("Grade: poor")).toHaveClass("bg-danger")

    const svg = document.querySelector("svg[role=img]")!
    expect(svg.querySelectorAll("polyline")).toHaveLength(2)
    expect(svg.querySelectorAll("[data-rumble]")).toHaveLength(4)
    const bars = within(screen.getByRole("list", { name: "Loudness by player" }))
    expect(bars.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Theo-30 dB", "Omar-34 dB"])
    expect(screen.getByText("Omar comes through 4 dB quieter than Theo.")).toBeInTheDocument()
  })

  it("shows the server's error", async () => {
    mockFetch(() => new Response(JSON.stringify({ detail: "no audio for this session" }), { status: 404 }))
    renderWithProviders(<QualityDialog session={savedSession({ id: ID })} open />)
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "no audio for this session",
    )
  })
})

describe("MergeDialog", () => {
  const current = savedSession({
    id: "b",
    n: 2,
    title: "Second half",
    started_at: 1_760_003_000,
    duration_s: 1000,
  })
  const same = savedSession({
    id: "a",
    n: 1,
    title: "First half",
    started_at: 1_760_000_000,
    duration_s: 2900,
  })
  const other = savedSession({
    id: "z",
    n: 3,
    title: "Much later",
    started_at: 1_770_000_000,
    duration_s: 100,
  })

  function Where() {
    return <p data-testid="where">{useLocation().pathname}</p>
  }
  function setup(merge: () => unknown = () => current) {
    const m = mockFetch((c) => (c.method === "GET" ? [other, current, same] : merge()))
    renderWithProviders(
      <>
        <MergeDialog session={current} open />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      { queryData: [[keys.sessions(), [other, current, same]]] },
    )
    return m
  }

  it("lists the same-sitting session first and never the session itself", () => {
    setup()
    const items = within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("First half")
    expect(items[0]).toHaveTextContent("Looks like the same sitting")
    expect(items[1]).toHaveTextContent("Much later")
  })

  it("confirms, merges earlier-then-later, and opens the session that remains", async () => {
    const { writes } = setup(() => same)
    expect(screen.getByRole("button", { name: "Merge…" })).toBeDisabled()
    fireEvent.click(screen.getByRole("radio", { name: /First half/ }))
    fireEvent.click(screen.getByRole("button", { name: "Merge…" }))
    expect(writes()).toEqual([])
    expect(screen.getByText(/You can undo this right after/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Merge sessions" }))
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sessions/a"))
    expect(writes()).toEqual([{ method: "POST", url: "/api/sessions/merge", body: { ids: ["a", "b"] } }])
  })

  it("shows the server's error and stays open", async () => {
    setup(() => new Response(JSON.stringify({ detail: "different recordings" }), { status: 409 }))
    fireEvent.click(screen.getByRole("radio", { name: /Much later/ }))
    fireEvent.click(screen.getByRole("button", { name: "Merge…" }))
    fireEvent.click(screen.getByRole("button", { name: "Merge sessions" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("different recordings")
    expect(screen.getByTestId("where")).toHaveTextContent("/")
  })
})
