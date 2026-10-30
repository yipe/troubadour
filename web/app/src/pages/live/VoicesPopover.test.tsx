import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { liveActions, useLiveStore } from "@troubadour/api/live"
import { mockFetch, player, session, voice } from "@troubadour/api/testing"
import { Toaster } from "@troubadour/ui/toast"
import { renderWithProviders } from "../../test/render.tsx"
import { VoicesList } from "./VoicesPopover.tsx"

function setup(handler: Parameters<typeof mockFetch>[0] = () => []) {
  const api = mockFetch(handler)
  return { api, ...render() }
}

function render() {
  return renderWithProviders(<VoicesList />, {
    live: {
      session: session(),
      players: [player({ id: "p1", name: "Priya" })],
      voices: [
        // 12 pending voices; seconds = index so "Voice 11" is the longest heard.
        ...Array.from({ length: 12 }, (_, i) => voice({ id: `v${i}`, label: `Voice ${i}`, seconds: i })),
        voice({ id: "named", label: "Voice 99", status: "named", player_id: "p1" }),
      ],
    },
  })
}

const pendingLabels = () => screen.queryAllByText(/^Voice \d+$/).map((el) => el.textContent)

describe("VoicesList", () => {
  it("shows the top 8 pending voices by seconds heard, and the named ones", () => {
    setup()
    expect(pendingLabels()).toEqual([
      "Voice 11",
      "Voice 10",
      "Voice 9",
      "Voice 8",
      "Voice 7",
      "Voice 6",
      "Voice 5",
      "Voice 4",
    ])
    expect(screen.getByText("Priya", { selector: "span" })).toBeInTheDocument()
  })

  it("Show all reveals every pending voice and can collapse again", () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Show all (12)" }))
    expect(pendingLabels()).toHaveLength(12)
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }))
    expect(pendingLabels()).toHaveLength(8)
  })

  it("keeps a voice focused from the transcript visible outside the top 8", () => {
    setup()
    act(() => liveActions.focusVoice("v0"))
    expect(pendingLabels()).toHaveLength(9)
    expect(screen.getByText("Voice 0")).toBeInTheDocument()
  })

  it("assigns a voice picked in the list, with its character", async () => {
    const api = mockFetch((c) =>
      c.method === "POST"
        ? { voice: voice({ id: "v11", status: "named", player_id: "p1" }), merged_into: null }
        : [],
    )
    renderWithProviders(
      <>
        <Toaster />
        <VoicesList />
      </>,
      {
        live: {
          session: session(),
          players: [player({ id: "p1", name: "Priya" })],
          voices: [voice({ id: "v11", label: "Voice 11" })],
        },
      },
    )
    fireEvent.change(screen.getByLabelText("Who is Voice 11?"), { target: { value: "p1" } })
    fireEvent.change(screen.getByLabelText("Character for Voice 11"), { target: { value: " Zed " } })
    fireEvent.click(screen.getByRole("button", { name: "Assign" }))
    await screen.findByText("Voice 11 is Priya (as Zed). Past lines relabeled.")
    expect(api.writes()[0]?.body).toEqual({ player_id: "p1", character: "Zed" })
  })

  it("unassigns a named voice", async () => {
    const { api } = setup(() => voice({ id: "named", label: "Voice 99" }))
    fireEvent.click(screen.getByRole("button", { name: "Unassign Voice 99" }))
    await waitFor(() =>
      expect(useLiveStore.getState().voices.find((v) => v.id === "named")?.status).toBe("pending"),
    )
    expect(api.writes()[0]?.url).toBe("/api/voices/named/unassign")
  })
})
