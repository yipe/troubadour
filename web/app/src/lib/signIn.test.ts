import { afterEach, describe, expect, it, vi } from "vitest"
import { openSignIn } from "./signIn"

function fakeTab() {
  return { opener: {} as unknown, location: { href: "" }, close: vi.fn() }
}

afterEach(() => vi.restoreAllMocks())

describe("openSignIn", () => {
  it("opens about:blank before the URL resolves, detaches the opener, then navigates", async () => {
    const tab = fakeTab()
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    let resolve!: (url: string) => void
    const pending = openSignIn(() => new Promise<string>((r) => (resolve = r)))
    expect(open).toHaveBeenCalledWith("about:blank", "_blank")
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe("")
    resolve("https://auth.example/start")
    await pending
    expect(tab.location.href).toBe("https://auth.example/start")
  })

  it("closes the tab and rethrows when getting the URL fails", async () => {
    const tab = fakeTab()
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    await expect(openSignIn(() => Promise.reject(new Error("offline")))).rejects.toThrow("offline")
    expect(tab.close).toHaveBeenCalled()
  })
})
