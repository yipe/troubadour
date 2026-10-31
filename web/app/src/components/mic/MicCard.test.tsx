import { useState } from "react"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applyAudioEvent, useAudio } from "@troubadour/api/live"
import type { Source, SourceList } from "@troubadour/api/session"
import { audioLevel, audioQuality, httpError, mic, mockFetch, savedSession } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { MicCard } from "./MicCard.tsx"

const JABRA = mic({
  name: "Jabra Speak 710",
  default: true,
  checks: [
    { id: "around", label: "Picks up voices all around", ok: true, detail: "Omnidirectional" },
    { id: "wired", label: "Wired", ok: false, detail: "Bluetooth" },
  ],
})
const YETI = mic({ name: "Yeti GX" })
const SOURCES: SourceList = {
  files: [{ name: "table.wav", duration: 90, audio_url: "/api/files/table.wav" }],
  mics: [],
}
const OLD = savedSession({ id: "s1", replayable: true })

function handler(extra: (c: { method: string; url: string }) => unknown = () => undefined) {
  return (c: { method: string; url: string }) => {
    const out = extra(c)
    if (out !== undefined) return out
    if (c.url === "/api/mics") return [JABRA, YETI]
    if (c.url === "/api/sessions") return [OLD]
    return undefined
  }
}

afterEach(() => vi.restoreAllMocks())

describe("MicCard", () => {
  it("never starts a mic test on mount; Test starts it for the chosen device, Stop ends it", async () => {
    const { writes } = mockFetch(
      handler((c) =>
        c.url === "/api/mic/test" ? { state: "running", device: "Yeti GX", seconds: 20 } : undefined,
      ),
    )
    renderWithProviders(
      <MicCard mode="settings" device={{ kind: "mic", device: "Yeti GX" }} onDeviceChange={() => {}} />,
    )
    await screen.findByRole("option", { name: "Yeti GX" })
    expect(writes()).toEqual([])

    fireEvent.click(screen.getByRole("button", { name: /Test/ }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument())
    expect(writes()).toEqual([{ method: "POST", url: "/api/mic/test", body: { device: "Yeti GX" } }])
    expect(screen.getByTestId("mic-test-countdown")).toHaveTextContent(/^(20|19)s$/)

    fireEvent.click(screen.getByRole("button", { name: /Stop/ }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Test/ })).toBeInTheDocument())
    expect(writes().at(-1)).toMatchObject({ method: "POST", url: "/api/mic/test/stop" })
  })

  it("shows the mic's checks, then level and noise after a test; the status follows the quality", async () => {
    mockFetch(handler())
    renderWithProviders(
      <MicCard mode="settings" device={{ kind: "mic", device: null }} onDeviceChange={() => {}} />,
    )
    expect(await screen.findByText("Omnidirectional")).toBeInTheDocument()
    expect(screen.getByTestId("mic-status")).toHaveAttribute("data-status", "neutral")
    expect(screen.getByRole("option", { name: "Jabra Speak 710 (default)" })).toBeInTheDocument()
    expect(screen.queryByText("Level")).toBeNull()

    act(() => applyAudioEvent({ type: "audio.quality", data: audioQuality({ source: "test" }) }))
    expect(screen.getByText("Level").closest("li")).toHaveTextContent("-34 dB avg")
    expect(screen.getByText("Background noise").closest("li")).toHaveTextContent("ok")
    // The Bluetooth check fails, so the card asks for attention.
    expect(screen.getByTestId("mic-status")).toHaveAttribute("data-status", "warning")
  })

  it("draws the live level into the 48 bars", async () => {
    mockFetch(handler())
    renderWithProviders(
      <MicCard mode="settings" device={{ kind: "mic", device: null }} onDeviceChange={() => {}} />,
    )
    await screen.findByText("Omnidirectional")
    expect(document.querySelectorAll("[data-bar]")).toHaveLength(48)
    act(() => applyAudioEvent({ type: "audio.level", data: audioLevel({ source: "test", db: -20 }) }))
    await waitFor(() =>
      expect(document.querySelector('[data-bar="47"]')).toHaveAttribute("data-zone", "good"),
    )
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "-20")
  })

  it("offers replay sources only in ready mode, and selecting one reports a file source", async () => {
    mockFetch(handler())
    const onChange = vi.fn()
    renderWithProviders(
      <MicCard
        mode="ready"
        device={{ kind: "mic", device: null }}
        onDeviceChange={onChange}
        sources={SOURCES}
      />,
    )
    const select = await screen.findByRole("combobox", { name: "Microphone" })
    await screen.findByRole("group", { name: "Replay a saved session…" })
    expect(screen.getByRole("group", { name: "Replay a file…" })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: "file:table.wav" } })
    expect(onChange).toHaveBeenCalledWith({ kind: "file", name: "table.wav", speed: 1 })
    fireEvent.change(select, { target: { value: "session:s1" } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: "session", id: "s1", speed: 1 })
    fireEvent.change(select, { target: { value: "mic:Yeti GX" } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: "mic", device: "Yeti GX" })
  })

  it("lists no replay sources in the wizard", async () => {
    const { calls } = mockFetch(handler())
    renderWithProviders(
      <MicCard
        mode="wizard"
        device={{ kind: "mic", device: null }}
        onDeviceChange={() => {}}
        sources={SOURCES}
      />,
    )
    await screen.findByRole("option", { name: "Yeti GX" })
    expect(screen.queryByRole("group", { name: /Replay/ })).toBeNull()
    expect(calls.some((c) => c.url === "/api/sessions")).toBe(false)
  })

  it("shows the server's message when the test can't start, and clears it on a device change", async () => {
    mockFetch(
      handler((c) =>
        c.url === "/api/mic/test" ? httpError(400, "Couldn't open Yeti GX: it isn't connected.") : undefined,
      ),
    )
    function Harness() {
      const [device, setDevice] = useState<Source>({ kind: "mic", device: "Yeti GX" })
      return <MicCard mode="settings" device={device} onDeviceChange={setDevice} />
    }
    renderWithProviders(<Harness />)
    await screen.findByRole("option", { name: "Yeti GX" })
    fireEvent.click(screen.getByRole("button", { name: /Test/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open Yeti GX: it isn't connected.")
    fireEvent.change(screen.getByRole("combobox", { name: "Microphone" }), {
      target: { value: "mic:Jabra Speak 710" },
    })
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("keeps an unplugged remembered mic as '(not connected)' and disables Test for it", async () => {
    const { writes } = mockFetch(handler())
    renderWithProviders(
      <MicCard mode="settings" device={{ kind: "mic", device: "Yeti 2" }} onDeviceChange={() => {}} />,
    )
    expect(await screen.findByRole("option", { name: "Yeti 2 (not connected)" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Test/ })).toBeDisabled()
    expect(screen.getByText("Yeti 2 isn't connected.")).toBeInTheDocument()
    expect(writes()).toEqual([])
  })

  it("Refresh microphones refetches the list", async () => {
    const { calls } = mockFetch(handler())
    renderWithProviders(
      <MicCard mode="settings" device={{ kind: "mic", device: null }} onDeviceChange={() => {}} />,
    )
    await screen.findByRole("option", { name: "Yeti GX" })
    const before = calls.filter((c) => c.url === "/api/mics").length
    fireEvent.click(screen.getByRole("button", { name: "Refresh microphones" }))
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/mics").length).toBe(before + 1))
  })

  it("polls the list every 2 s, but not while a mic test runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { calls } = mockFetch(handler())
      renderWithProviders(
        <MicCard mode="settings" device={{ kind: "mic", device: null }} onDeviceChange={() => {}} />,
      )
      await screen.findByRole("option", { name: "Yeti GX" })
      const count = () => calls.filter((c) => c.url === "/api/mics").length
      const first = count()
      await act(() => vi.advanceTimersByTimeAsync(2100))
      expect(count()).toBeGreaterThan(first)

      act(() => useAudio.setState({ micTest: "running" }))
      const during = count()
      await act(() => vi.advanceTimersByTimeAsync(6000))
      expect(count()).toBe(during)
    } finally {
      act(() => useAudio.setState({ micTest: "stopped" }))
      vi.useRealTimers()
    }
  })
})
