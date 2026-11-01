import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyTheme,
  readTheme,
  resolveTheme,
  saveTheme,
  THEME_BOOT_SCRIPT,
  THEME_KEY,
  watchSystemTheme,
} from "./theme-choice"

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

  it("switches with transitions paused, so nothing fades in late", () => {
    vi.useFakeTimers()
    stubMedia(false)
    applyTheme("dark")
    vi.runAllTimers()
    applyTheme("light")
    expect(document.head.querySelector("style")?.textContent).toContain("transition:none!important")
    vi.runAllTimers()
    expect(document.head.querySelector("style")).toBeNull()
    vi.useRealTimers()
  })

  it("leaves transitions alone when the theme doesn't change", () => {
    stubMedia(false)
    document.documentElement.dataset.theme = "dark"
    applyTheme("dark")
    expect(document.head.querySelector("style")).toBeNull()
  })
})

describe("THEME_BOOT_SCRIPT", () => {
  const boot = () => {
    delete document.documentElement.dataset.theme
    new Function(THEME_BOOT_SCRIPT)()
    return document.documentElement.dataset.theme
  }
  const expected = () => resolveTheme(readTheme(), matchMedia("").matches)

  it("themes the page the way applyTheme(readTheme()) does", () => {
    for (const light of [true, false]) {
      stubMedia(light)
      for (const stored of [null, "dark", "light", "midnight", "system", "sepia"]) {
        localStorage.clear()
        if (stored) localStorage.setItem(THEME_KEY, stored)
        expect(boot(), `${stored} with a ${light ? "light" : "dark"} OS`).toBe(expected())
      }
    }
  })

  it("follows the OS when storage throws", () => {
    stubMedia(true)
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(boot()).toBe("light")
  })
})
