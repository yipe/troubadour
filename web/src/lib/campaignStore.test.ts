import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"
import { attempt } from "./campaignStore"
import { useLlmProviders } from "./llmStore"

afterEach(() => {
  vi.restoreAllMocks()
  useLlmProviders.setState({ modelsOpen: false })
})

describe("attempt", () => {
  it("offers to open Models when the error points there", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 1)
    const message =
      "Couldn't reach the model server at http://127.0.0.1:1235/v1. Is it running? (Models picks the server.)"
    expect(await attempt(() => Promise.reject(new Error(message)))).toBeUndefined()
    const [shown, options] = error.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect(shown).toBe(message)
    expect(options.action.label).toBe("Open Models")
    options.action.onClick()
    expect(useLlmProviders.getState().modelsOpen).toBe(true)
  })

  it("shows other errors plainly", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 1)
    await attempt(() => Promise.reject(new Error("That session has no lines.")))
    expect(error).toHaveBeenCalledWith("That session has no lines.")
  })
})
