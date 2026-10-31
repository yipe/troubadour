import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { mic, mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../../test/render.tsx"
import { MicDetails } from "./MicDetails.tsx"

const YETI = mic({
  name: "Yeti GX",
  maker: "Logitech",
  specs: { source: "catalog", model: "Yeti GX", capsule: "dynamic", patterns: ["supercardioid"] },
  checks: [{ id: "around", label: "Picks up voices all around", ok: false, detail: "One voice in front" }],
})
const MYSTERY = mic({ name: "USB Audio Device", default: true, checks: [] })

afterEach(() => vi.restoreAllMocks())

it("shows the saved specs and advice for the first failing check", async () => {
  mockFetch(() => [YETI, MYSTERY])
  renderWithProviders(<MicDetails device="Yeti GX" />)
  const form = await screen.findByRole("form", { name: "Microphone specs" })
  expect(within(form).getByLabelText("Model")).toHaveValue("Yeti GX")
  expect(within(form).getByLabelText("Capsule")).toHaveValue("dynamic")
  expect(within(form).getByRole("button", { name: "Supercardioid" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.getByRole("note")).toHaveTextContent("built for one voice up close")
})

it("PATCHes the edited specs for the mic, and the default mic is used when none is chosen", async () => {
  const { writes } = mockFetch((c) => (c.method === "PATCH" ? MYSTERY : [YETI, MYSTERY]))
  renderWithProviders(<MicDetails device={null} />)
  const form = await screen.findByRole("form", { name: "Microphone specs" })
  fireEvent.change(within(form).getByLabelText("Capsule"), { target: { value: "condenser" } })
  fireEvent.click(within(form).getByRole("button", { name: "Omni" }))
  fireEvent.click(within(form).getByRole("button", { name: "Boundary" }))
  fireEvent.click(within(form).getByRole("button", { name: "Boundary" }))
  fireEvent.click(within(form).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toEqual({
    method: "PATCH",
    url: "/api/mics/USB%20Audio%20Device",
    body: { patterns: ["omni"], wireless: false, notes: "", capsule: "condenser" },
  })
})

it("the monitor switch PUTs the new state", async () => {
  const { writes } = mockFetch((c) => (c.method === "PUT" ? { on: false } : [MYSTERY]))
  renderWithProviders(<MicDetails device={null} />)
  fireEvent.click(await screen.findByRole("switch", { name: "Monitor the level during sessions" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toEqual({ method: "PUT", url: "/api/audio/monitor", body: { on: false } })
})
