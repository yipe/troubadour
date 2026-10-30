import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Checkbox } from "./checkbox"
import { ColorSwatchPicker } from "./color-swatch-picker"
import { Field } from "./field"
import { Input } from "./input"
import { Switch } from "./switch"

afterEach(cleanup)

describe("Field", () => {
  it("connects the label to the control and shows the error", () => {
    render(
      <Field label="Name" error="Required">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText("Name")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription("Required")
  })
})

describe("Switch and Checkbox", () => {
  it("Switch toggles and reports it", async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Auto" onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole("switch", { name: "Auto" }))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it("Checkbox toggles and reports it", async () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Agree" onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole("checkbox", { name: "Agree" }))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })
})

describe("ColorSwatchPicker", () => {
  it("picks a swatch, marks the selected one and clears to null", async () => {
    const onChange = vi.fn()
    render(<ColorSwatchPicker value="#3182CE" onChange={onChange} allowClear />)
    await userEvent.click(screen.getByRole("button", { name: /Colour/ }))
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Dark Red" })).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(screen.getByRole("button", { name: "Dark Red" }))
    expect(onChange).toHaveBeenLastCalledWith("#E53E3E")
    await userEvent.click(screen.getByRole("button", { name: "Use class colour" }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it("shows auto when there is no colour", () => {
    render(<ColorSwatchPicker value={null} onChange={() => {}} />)
    expect(screen.getByText("auto")).toBeInTheDocument()
  })
})
