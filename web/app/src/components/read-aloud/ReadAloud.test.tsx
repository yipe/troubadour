import { fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import {
  campaign,
  campaignJob,
  cloneClip,
  cloneVoice,
  mockFetch,
  player,
  snapshotBase,
} from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { ReadAloud } from "./ReadAloud.tsx"

afterEach(() => vi.restoreAllMocks())

const ALEX = player({ id: "p1", name: "Alex", clone_ok: true })
const VOICES = { voices: { p1: cloneVoice({ player_id: "p1" }) }, profiles: {}, clips: [] }

describe("ReadAloud", () => {
  it("is disabled with a tooltip when nobody has a clone", async () => {
    mockFetch(() => ({}))
    renderWithProviders(<ReadAloud sessionId="s1" />, {
      live: { ...snapshotBase(), players: [ALEX] },
      queryData: [[keys.clones(), { voices: {}, profiles: {}, clips: [] }]],
    })
    expect(screen.getByRole("button", { name: /Read aloud/ })).toBeDisabled()
    fireEvent.focus(screen.getByRole("button", { name: /Read aloud/ }).parentElement!)
    expect(await screen.findByText("Make a voice clone in Settings › Players & voices")).toBeTruthy()
  })

  it("starts the read job on click", async () => {
    const { writes } = mockFetch(() => campaignJob({ id: "j1", kind: "read", player_id: "p1" }))
    renderWithProviders(<ReadAloud sessionId="s1" />, {
      live: { ...snapshotBase(), players: [ALEX] },
      queryData: [[keys.clones(), VOICES]],
    })
    fireEvent.click(screen.getByRole("button", { name: "Read aloud in Alex's voice" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "POST", url: "/api/players/p1/clone/read" })
  })

  it("does not play a finished clip until it is clicked", () => {
    mockFetch(() => ({}))
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue()
    renderWithProviders(<ReadAloud sessionId="s1" />, {
      live: { ...snapshotBase(), players: [ALEX] },
      queryData: [
        [
          keys.clones(),
          {
            ...VOICES,
            clips: [
              cloneClip({
                id: "c1",
                player_id: "p1",
                kind: "read",
                source: { session: "s1" },
                url: "/c1.wav",
              }),
            ],
          },
        ],
        [
          keys.campaign(),
          campaign({
            jobs: [campaignJob({ id: "j1", kind: "read", title: "s1", player_id: "p1", state: "done" })],
          }),
        ],
      ],
    })
    expect(play).not.toHaveBeenCalled()
    const button = screen.getByRole("button", { name: "Play read-aloud clip" })
    expect(document.querySelector("audio")?.getAttribute("preload")).toBe("none")
    expect(document.querySelector("audio")?.hasAttribute("autoplay")).toBe(false)
    fireEvent.click(button)
    expect(play).toHaveBeenCalledTimes(1)
  })
})
