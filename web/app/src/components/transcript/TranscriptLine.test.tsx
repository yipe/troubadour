import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { message, player, voice } from "@troubadour/api/testing"
import "../../test/setup.ts"
import { TranscriptLine } from "./TranscriptLine.tsx"
import { recordToViewLines, toViewLines, type ViewLine } from "./viewLines.ts"

const base: ViewLine = {
  id: "m1",
  t: 65,
  speaker: { name: "Priya", color: "#f00", as: "Pip" },
  text: "I deal 12 damage",
  fixes: [],
}

describe("TranscriptLine", () => {
  it("shows time, name, the character note and text", () => {
    render(<TranscriptLine line={base} />)
    expect(screen.getByText("1:05")).toBeInTheDocument()
    expect(screen.getByText("Priya")).toBeInTheDocument()
    expect(screen.getByText(/as Pip/)).toBeInTheDocument()
    expect(screen.getByText("I deal 12 damage")).toBeInTheDocument()
  })

  it("shows an unnamed voice's label and text in italics", () => {
    render(<TranscriptLine line={{ ...base, speaker: null, label: "Voice 3" }} />)
    expect(screen.getByText("Voice 3")).toHaveClass("italic")
    expect(screen.getByText("I deal 12 damage")).toHaveClass("italic")
  })

  it("underlines fixes with what was heard", () => {
    const text = "Elara takes 8"
    const { container } = render(
      <TranscriptLine line={{ ...base, text, fixes: [{ start: 0, end: 5, heard: "Dallara" }] }} />,
    )
    const fix = container.querySelector("[data-fix]")!
    expect(fix).toHaveTextContent("Elara")
    expect(fix).toHaveAttribute("title", 'Heard as "Dallara"')
  })

  it("makes the timestamp and speaker clickable only when handlers are given", async () => {
    const onTimestamp = vi.fn()
    const onSpeakerClick = vi.fn()
    const { rerender } = render(<TranscriptLine line={base} />)
    expect(screen.queryByRole("button")).toBeNull()
    rerender(<TranscriptLine line={base} onTimestamp={onTimestamp} onSpeakerClick={onSpeakerClick} />)
    await userEvent.click(screen.getByRole("button", { name: "1:05" }))
    expect(onTimestamp).toHaveBeenCalledWith(base)
    await userEvent.click(screen.getByRole("button", { name: "Priya" }))
    expect(onSpeakerClick).toHaveBeenCalledWith(base, screen.getByRole("button", { name: "Priya" }))
  })
})

describe("view line builders", () => {
  it("builds live lines from voices and players", () => {
    const lines = toViewLines(
      [
        message({ id: "a", voice_id: "v1", text: "hi", t_start: 3 }),
        message({ id: "b", voice_id: "v2", text: "yo", confidence: 0.3 }),
      ],
      [voice({ id: "v1", status: "named", player_id: "p1" }), voice({ id: "v2", label: "Voice 2" })],
      [player({ id: "p1", name: "Priya", character: "Pip", color: "#abc" })],
    )
    expect(lines[0]).toMatchObject({ id: "a", t: 3, speaker: { name: "Priya", color: "#abc", as: "Pip" } })
    expect(lines[1]).toMatchObject({ speaker: null, label: "Voice 2", unsure: true })
  })

  it("builds saved lines in time order, tolerating a player missing from the roster", () => {
    const lines = recordToViewLines({
      players: [{ id: "p1", name: "Priya", character: "Pip", is_gm: false, color: "#abc" }],
      messages: [
        {
          id: "b",
          t_start: 9,
          speaker: "Ghost",
          player_id: "p9",
          character: null,
          text: "b",
          provisional: false,
          confidence: 1,
        },
        {
          id: "a",
          t_start: 1,
          speaker: "Priya",
          player_id: "p1",
          character: "Pip",
          text: "a",
          provisional: false,
          confidence: 1,
        },
        {
          id: "c",
          t_start: 5,
          speaker: "Voice 4",
          player_id: null,
          character: null,
          text: "c",
          provisional: true,
          confidence: 1,
        },
      ],
    } as never)
    expect(lines.map((l) => l.id)).toEqual(["a", "c", "b"])
    expect(lines[0]?.speaker).toEqual({ name: "Priya", color: "#abc", as: "Pip" })
    expect(lines[1]).toMatchObject({ speaker: null, label: "Voice 4", unsure: true })
    expect(lines[2]?.speaker?.name).toBe("Ghost")
  })
})
