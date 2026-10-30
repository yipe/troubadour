import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { MentionBits } from "./MentionBits.tsx"

const data = {
  sessions: [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
    { id: "c", n: 3 },
    { id: "d", n: 4 },
  ],
  counts: { Orsa: [0, 1, 3, 5] },
}

it("draws a dot per session, lit where mentioned, with a label and titles", () => {
  render(<MentionBits data={data} name="Orsa" item={false} />)
  expect(screen.getByRole("img", { name: "Mentioned in 3 of 4 sessions" })).toBeInTheDocument()
  const bits = screen.getAllByTestId("mention-bit")
  expect(bits.map((b) => b.dataset.count)).toEqual(["0", "1", "3", "5"])
  expect(bits[0]).toHaveClass("bg-line")
  expect(bits[1]).toHaveClass("bg-accent", "opacity-40")
  expect(bits[2]).toHaveClass("opacity-70")
  expect(bits[3]).toHaveClass("opacity-100")
  expect(bits[2]).toHaveAttribute("title", "S3: 3 mentions")
  expect(bits[1]).toHaveAttribute("title", "S2: 1 mention")
})

it("treats an entry the server left out as never mentioned, and items use legendary", () => {
  const { rerender } = render(<MentionBits data={data} name="Nobody" item />)
  expect(screen.getByRole("img", { name: "Mentioned in 0 of 4 sessions" })).toBeInTheDocument()
  rerender(<MentionBits data={{ ...data, counts: { Gull: [2, 0, 0, 0] } }} name="Gull" item />)
  expect(screen.getAllByTestId("mention-bit")[0]).toHaveClass("bg-legendary")
})

it("renders nothing while loading", () => {
  const { container } = render(<MentionBits data={undefined} name="Orsa" item={false} />)
  expect(container).toBeEmptyDOMElement()
})
