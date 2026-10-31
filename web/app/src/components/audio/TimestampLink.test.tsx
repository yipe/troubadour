import { fireEvent, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useLocation } from "react-router"
import { renderWithProviders } from "../../test/render.tsx"
import { SessionAudioProvider } from "./SessionAudioProvider.tsx"
import { TimestampLink } from "./TimestampLink.tsx"

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function setup(hasAudio: boolean, onJump?: (t: number) => void) {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  renderWithProviders(
    <SessionAudioProvider>
      <TimestampLink sessionId="s12" t={6115} n={12} hasAudio={hasAudio} onJump={onJump} />
      <Where />
    </SessionAudioProvider>,
  )
  return play
}

afterEach(() => vi.restoreAllMocks())

describe("TimestampLink", () => {
  it("shows the session number and clock, and never plays on render", () => {
    const play = setup(true)
    expect(screen.getByRole("button", { name: "S12 · 1:41:55" })).toBeInTheDocument()
    expect(play).not.toHaveBeenCalled()
  })

  it("plays the recording from t on click when there is audio", () => {
    const onJump = vi.fn()
    const play = setup(true, onJump)
    fireEvent.click(screen.getByRole("button"))
    const audio = document.querySelector("audio")!
    expect(audio.getAttribute("src")).toBe("/api/sessions/s12/audio.wav")
    audio.dispatchEvent(new Event("loadedmetadata"))
    expect(audio.currentTime).toBe(6115)
    expect(play).toHaveBeenCalledTimes(1)
    expect(onJump).toHaveBeenCalledWith(6115)
    expect(screen.getByTestId("where")).toHaveTextContent("/")
  })

  it("turns into a stop button while its moment plays, and stops it", () => {
    setup(true)
    fireEvent.click(screen.getByRole("button", { name: "S12 · 1:41:55" }))
    const audio = document.querySelector("audio")!
    audio.dispatchEvent(new Event("loadedmetadata"))
    const stop = screen.getByRole("button", { name: "Stop S12 · 1:41:55" })
    fireEvent.click(stop)
    expect(screen.getByRole("button", { name: "S12 · 1:41:55" })).toBeInTheDocument()
  })

  it("opens the session at the transcript line at t when there is no audio", () => {
    const play = setup(false)
    fireEvent.click(screen.getByRole("button"))
    expect(play).not.toHaveBeenCalled()
    expect(screen.getByTestId("where")).toHaveTextContent("/sessions/s12?t=6115")
  })
})
