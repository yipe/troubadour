import { afterEach, describe, expect, it, vi } from "vitest"
import { applyTheme, readTheme, resolveTheme, saveTheme, THEME_KEY, watchSystemTheme } from "./theme.ts"

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

function stubMedia(light: boolean) {
  let listener: () => void = () => {}
  const query = {
    matches: light,
    addEventListener: (_: string, l: () => void) => (listener = l),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal("matchMedia", () => query)
  return {
    flip(next: boolean) {
      query.matches = next
      listener()
    },
    query,
  }
}

describe("readTheme", () => {
  it("returns the stored choice", () => {
    saveTheme("midnight")
    expect(readTheme()).toBe("midnight")
  })
  it("falls back to system for nothing or a bad value", () => {
    expect(readTheme()).toBe("system")
    localStorage.setItem(THEME_KEY, "sepia")
    expect(readTheme()).toBe("system")
  })
  it("falls back to system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readTheme()).toBe("system")
  })
})

describe("resolveTheme", () => {
  it("lets a stored choice win over the OS", () => {
    expect(resolveTheme("midnight", true)).toBe("midnight")
    expect(resolveTheme("light", false)).toBe("light")
  })
  it("follows the OS for system", () => {
    expect(resolveTheme("system", true)).toBe("light")
    expect(resolveTheme("system", false)).toBe("dark")
  })
})

describe("applyTheme and watchSystemTheme", () => {
  it("system follows the media query, live", () => {
    const media = stubMedia(false)
    expect(applyTheme("system")).toBe("dark")
    const stop = watchSystemTheme(() => "system")
    media.flip(true)
    expect(document.documentElement.dataset.theme).toBe("light")
    stop()
    expect(media.query.removeEventListener).toHaveBeenCalled()
  })
  it("ignores OS changes when a theme is chosen", () => {
    const media = stubMedia(false)
    applyTheme("midnight")
    watchSystemTheme(() => "midnight")
    media.flip(true)
    expect(document.documentElement.dataset.theme).toBe("midnight")
  })
})
