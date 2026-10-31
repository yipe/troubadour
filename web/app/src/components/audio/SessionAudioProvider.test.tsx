import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SessionAudioProvider, useSessionAudio } from "./SessionAudioProvider.tsx"

function Controls() {
  const { play, playing } = useSessionAudio()
  return (
    <>
      <button onClick={() => play("a", 5)}>a</button>
      <button onClick={() => play("b", 9)}>b</button>
      <p data-testid="now">{playing ? `${playing.sessionId}@${playing.t}` : "stopped"}</p>
    </>
  )
}

function setup() {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
  render(
    <SessionAudioProvider>
      <Controls />
    </SessionAudioProvider>,
  )
  return { play, audio: document.querySelector("audio")! }
}

afterEach(() => vi.restoreAllMocks())

describe("SessionAudioProvider", () => {
  it("a request superseded before its metadata loads never starts", () => {
    const { play, audio } = setup()
    fireEvent.click(screen.getByText("a"))
    fireEvent.click(screen.getByText("b"))
    fireEvent(audio, new Event("loadedmetadata"))
    expect(play).toHaveBeenCalledTimes(1)
    expect(audio.currentTime).toBe(9)
  })

  it("waits for metadata before seeking when the same file has not loaded yet", () => {
    const { play, audio } = setup()
    fireEvent.click(screen.getByText("a"))
    fireEvent.click(screen.getByText("a"))
    expect(play).not.toHaveBeenCalled()
    fireEvent(audio, new Event("loadedmetadata"))
    expect(play).toHaveBeenCalledTimes(1)
  })

  it("restores the playing state when playback begins again after a pause", () => {
    const { audio } = setup()
    fireEvent.click(screen.getByText("a"))
    fireEvent(audio, new Event("loadedmetadata"))
    act(() => void fireEvent(audio, new Event("pause")))
    expect(screen.getByTestId("now")).toHaveTextContent("stopped")
    fireEvent(audio, new Event("play"))
    expect(screen.getByTestId("now")).toHaveTextContent("a@5")
  })
})
