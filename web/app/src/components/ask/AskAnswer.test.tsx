import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { answerSource, campaignAnswer } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { AskAnswer } from "./AskAnswer.tsx"

const sources = [
  answerSource({ id: "S1", kind: "note", label: "Notes", path: "Lore/a.md", excerpt: "A note." }),
  answerSource({
    id: "S2",
    kind: "transcript",
    label: "Orsa · Session 10 · 0:41",
    session: "s10",
    t: 41,
    excerpt: "keeps what the tide leaves",
  }),
]
const done = campaignAnswer({
  id: "a1",
  question: "q",
  answer: "She said “keeps what the tide leaves” [S2], and the abbey agrees [S1].",
  sources,
})

afterEach(() => vi.restoreAllMocks())

describe("AskAnswer", () => {
  it("numbers citations in source order and matches them to the rows", () => {
    renderWithProviders(<AskAnswer answer={done} onSource={() => {}} />)
    expect(screen.getAllByLabelText(/^Source \d$/).map((e) => e.textContent)).toEqual(["1", "2"])
    const rows = within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem")
    expect(rows[0]).toHaveTextContent("1")
    expect(rows[0]).toHaveTextContent("Session 10")
    expect(rows[1]).toHaveTextContent("A note.")
    expect(screen.getByText("“keeps what the tide leaves”")).toHaveClass("bg-accent-soft")
  })

  it("plays the transcript source's line", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
    const onSource = vi.fn()
    renderWithProviders(<AskAnswer answer={done} onSource={onSource} />, {
      queryData: [[keys.sessions(), [{ id: "s10", audio: true }]]],
    })
    expect(play).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Play line" }))
    const audio = document.querySelector("audio")!
    expect(audio.getAttribute("src")).toBe("/api/sessions/s10/audio.wav")
    audio.dispatchEvent(new Event("loadedmetadata"))
    expect(audio.currentTime).toBe(41)
    expect(play).toHaveBeenCalledTimes(1)
    expect(onSource).toHaveBeenCalledWith(sources[1])
  })

  it("shows the stats footer only with stats", () => {
    const first = renderWithProviders(<AskAnswer answer={done} onSource={() => {}} />)
    expect(screen.queryByText(/Answered on this computer/)).toBeNull()
    first.unmount()
    renderWithProviders(
      <AskAnswer
        answer={{ ...done, stats: { seconds: 4.2, transcripts: 13, notes: 214 } }}
        onSource={() => {}}
      />,
    )
    expect(
      screen.getByText(/Answered on this computer in 4 s from 13 transcripts and 214 notes/),
    ).toBeInTheDocument()
  })

  it("says so while searching, when it failed, and when the notes are silent", () => {
    const searching = renderWithProviders(
      <AskAnswer
        answer={campaignAnswer({
          id: "a",
          state: "searching",
          stats: { seconds: 0, transcripts: 13, notes: 214 },
        })}
        onSource={() => {}}
      />,
    )
    expect(screen.getByText("Searching 13 transcripts and 214 notes on this computer…")).toBeInTheDocument()
    searching.unmount()
    const failed = renderWithProviders(
      <AskAnswer
        answer={campaignAnswer({ id: "a", state: "error", message: "LM Studio is off" })}
        onSource={() => {}}
        retry={<button>Try again</button>}
      />,
    )
    expect(screen.getByText("LM Studio is off")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
    failed.unmount()
    renderWithProviders(<AskAnswer answer={campaignAnswer({ id: "a", found: false })} onSource={() => {}} />)
    expect(screen.getByText("The notes don't say.")).toBeInTheDocument()
  })
})
