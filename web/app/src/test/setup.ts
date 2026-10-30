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
// jsdom's media methods only log "Not implemented"; nothing in a test may play audio anyway.
HTMLMediaElement.prototype.play = () => Promise.resolve()
HTMLMediaElement.prototype.pause = () => {}
HTMLMediaElement.prototype.load = () => {}

afterEach(() => {
  cleanup()
  resetLive()
})
