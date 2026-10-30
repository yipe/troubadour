import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "./confirm-dialog"
import { notify, Toaster } from "./toast"

afterEach(() => {
  cleanup()
  toast.dismiss()
})

function renderConfirm(onConfirm: () => void | Promise<void>, onOpenChange = vi.fn()) {
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete it?"
      body="Gone forever."
      confirmLabel="Delete"
      tone="danger"
      onConfirm={onConfirm}
    />,
  )
  return onOpenChange
}

describe("ConfirmDialog", () => {
  it("calls onConfirm and closes when it resolves", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = renderConfirm(onConfirm)
    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("shows the error and stays open when onConfirm rejects", async () => {
    const onOpenChange = renderConfirm(() => Promise.reject(new Error("nope")))
    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("nope")
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe("notify", () => {
  it("calls undo once when Undo is clicked", async () => {
    const undo = vi.fn()
    // jsdom has no pointer capture, which sonner calls on pointerdown.
    Element.prototype.setPointerCapture = vi.fn()
    render(<Toaster />)
    notify("Dismissed", { undo })
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }))
    expect(undo).toHaveBeenCalledOnce()
  })
})
