import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { resetLive } from "@troubadour/api/live"

// jsdom has neither; layout-dependent code (virtual lists, scroll-to-line, popovers) needs them.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  resetLive()
})
