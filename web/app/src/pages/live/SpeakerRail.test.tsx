import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { applyEvent, applySpeaker } from "@troubadour/api/live"
import { bodyOf, message, mockFetch, player, session, voice } from "@troubadour/api/testing"
import { Toaster } from "@troubadour/ui/toast"
import { renderWithProviders } from "../../test/render.tsx"
import { LivePage } from "./LivePage.tsx"

const MAYA = player({ id: "p1", name: "Maya", character: "Velis" })
const ALEX = player({ id: "p2", name: "Alex", is_gm: true })
const VOICES = [
  voice({ id: "v1", label: "Voice 1", status: "named", player_id: "p1" }),
  voice({ id: "v2", label: "Voice 2", status: "named", player_id: "p2" }),
  voice({ id: "v3", label: "Voice 3", seconds: 4, suggested_player_id: "p2" }),
]

function setup(live: Parameters<typeof renderWithProviders>[1] = {}) {
  const api = mockFetch((c) => {
    if (c.method === "POST" && c.url === "/api/voices/v3/assign") {
      const b = bodyOf<{ player_id: string; character: string | null }>(c)
      return {
        voice: { ...VOICES[2], status: "named", player_id: b.player_id, character: b.character },
        merged_into: null,
      }
    }
    if (c.url === "/api/sessions" || c.url === "/api/classes") return []
    if (c.method === "POST") return session({ status: "paused" })
    return undefined
  })
  const result = renderWithProviders(
    <>
      <Toaster />
      <LivePage />
    </>,
    {
      ...live,
      live: { session: session(), players: [MAYA, ALEX], voices: VOICES, ...live.live },
    },
  )
  return { api, ...result }
}

afterEach(() => applySpeaker(null))

describe("speaker rail", () => {
  it("shows each player's share of talk time and highlights who is speaking", () => {
    setup({
      live: {
        messages: [
          message({ id: "a", voice_id: "v1", t_start: 0, t_end: 75 }),
          message({ id: "b", voice_id: "v2", t_start: 75, t_end: 100 }),
        ],
      },
    })
    const maya = document.querySelector<HTMLElement>('[data-player-id="p1"]')!
    const alex = document.querySelector<HTMLElement>('[data-player-id="p2"]')!
    expect(within(maya).getByTestId("talk-share")).toHaveTextContent("75%")
    expect(within(alex).getByTestId("talk-share")).toHaveTextContent("25%")
    expect(maya).not.toHaveAttribute("data-speaking")
    act(() => applySpeaker("v1"))
    expect(maya).toHaveAttribute("data-speaking")
    expect(alex).not.toHaveAttribute("data-speaking")
  })

  it("moves the share live when a line is relabeled", () => {
    setup({ live: { messages: [message({ id: "a", voice_id: "v1", t_start: 0, t_end: 50 })] } })
    const share = (id: string) =>
      document.querySelector(`[data-player-id="${id}"] [data-testid="talk-share"]`)
    expect(share("p1")).toHaveTextContent("100%")
    act(() => applyEvent({ type: "messages.updated", data: [{ id: "a", voice_id: "v2" }] }))
    expect(share("p1")).toHaveTextContent("0%")
    expect(share("p2")).toHaveTextContent("100%")
  })

  it("shows the listening status, and the paused one", () => {
    const { unmount } = setup({ live: { session: session({ source: { kind: "mic", device: "Jabra" } }) } })
    expect(screen.getByText("Listening · Jabra")).toBeInTheDocument()
    unmount()
    setup({ live: { session: session({ status: "paused" }) } })
    expect(screen.getByText("Paused · not listening")).toBeInTheDocument()
  })

  it("a quick pick names the voice and hides the card", async () => {
    const { api } = setup()
    expect(screen.getByText(/4 s heard/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Maya" }))
    await waitFor(() => expect(screen.queryByText(/4 s heard/)).toBeNull())
    expect(api.writes()[0]).toMatchObject({
      url: "/api/voices/v3/assign",
      body: { player_id: "p1", character: null },
    })
    expect(await screen.findByText("Voice 3 is Maya. Past lines relabeled.")).toBeInTheDocument()
  })

  it("the GM pick comes first as 'as NPC' and asks for the character", async () => {
    const { api } = setup()
    const chips = screen
      .getAllByRole("button")
      .filter((b) => /as NPC|^Maya$|^Later$/.test(b.textContent ?? ""))
    expect(chips.map((b) => b.textContent)).toEqual(["Alex as NPC", "Maya", "Later"])
    fireEvent.click(chips[0]!)
    fireEvent.change(screen.getByLabelText("Character Alex is voicing"), { target: { value: "Choir voice" } })
    fireEvent.click(screen.getByRole("button", { name: "Assign" }))
    await waitFor(() => expect(api.writes()).toHaveLength(1))
    expect(api.writes()[0]?.body).toEqual({ player_id: "p2", character: "Choir voice" })
    expect(
      await screen.findByText("Voice 3 is Alex (as Choir voice). Past lines relabeled."),
    ).toBeInTheDocument()
  })

  it("Later hides the card until a new pending voice appears", () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Later" }))
    expect(screen.queryByText(/4 s heard/)).toBeNull()
    act(() => applyEvent({ type: "voice.upserted", data: voice({ id: "v4", label: "Voice 4", seconds: 2 }) }))
    expect(screen.getByText(/2 s heard/)).toBeInTheDocument()
  })

  it("Pause calls pause", async () => {
    const { api } = setup()
    fireEvent.click(screen.getByRole("button", { name: /Pause/ }))
    await waitFor(() => expect(api.writes().map((w) => w.url)).toEqual(["/api/session/pause"]))
  })

  it("Resume calls resume while paused", async () => {
    const { api } = setup({ live: { session: session({ status: "paused" }) } })
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }))
    await waitFor(() => expect(api.writes().map((w) => w.url)).toEqual(["/api/session/resume"]))
  })
})
