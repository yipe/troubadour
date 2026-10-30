import { fireEvent, screen, waitFor } from "@testing-library/react"
import { Route, Routes } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import type { Recap } from "@troubadour/api/recap"
import { bodyOf, campaignJob, mockFetch, savedSession, sessionRecord } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { discordMarkdown } from "./discord.ts"
import { Component as RecapPage } from "./index.tsx"

const toPng = vi.fn(async () => "data:image/png;base64,AAAA")
vi.mock("html-to-image", () => ({ toPng: (...a: unknown[]) => toPng(...(a as [])) }))

afterEach(() => vi.restoreAllMocks())

const recap: Recap = {
  title: "Previously, at the Abbey…",
  body: "The tide turned.",
  quote: { text: "That's the clapper.", speaker: "Velis", player_id: "p1", t: 6031 },
  moments: [{ player_id: "p1", text: "Cracked the riddle" }],
  questions: ["Who rang the bell?"],
  options: {
    voice: "narrator",
    length_s: 45,
    include: { happened: true, quote: true, moments: true, questions: true },
  },
  built_at: 5,
}

function open(reviewed: boolean, stored: Recap | null = recap) {
  const m = mockFetch((c) => {
    if (c.url === "/api/sessions") {
      return [savedSession({ id: "s1", n: 12, reviewed_at: reviewed ? 1 : null })]
    }
    if (c.url === "/api/sessions/s1/transcript.json") {
      return sessionRecord({
        id: "s1",
        players: [{ id: "p1", name: "Maya", character: "Velis", is_gm: false, color: "#8b5cf6" }],
      })
    }
    if (c.url === "/api/sessions/s1/recap") {
      return c.method === "POST" ? campaignJob({ id: "j", kind: "recap", title: "s1" }) : stored
    }
    return c.url === "/api/clones" ? { voices: {}, profiles: {}, clips: [] } : []
  })
  renderWithProviders(
    <Routes>
      <Route path="/sessions/:id/recap" element={<RecapPage />} />
    </Routes>,
    { route: "/sessions/s1/recap" },
  )
  return m
}

it("an option change rebuilds with the new options after the debounce", async () => {
  const m = open(true)
  await screen.findByText("The tide turned.")
  fireEvent.click(screen.getByRole("radio", { name: "Bullet notes" }))
  expect(m.writes()).toHaveLength(0)
  await waitFor(() => expect(m.writes()).toHaveLength(1))
  expect(m.writes()[0]).toMatchObject({ method: "POST", url: "/api/sessions/s1/recap" })
  expect(bodyOf(m.writes()[0]!)).toEqual({ ...recap.options, voice: "bullets" })
})

it("Copy for Discord writes the Markdown", async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
  open(true)
  await screen.findByText("The tide turned.")
  fireEvent.click(screen.getByRole("button", { name: /Copy for Discord/ }))
  await waitFor(() => expect(writeText).toHaveBeenCalled())
  expect(writeText).toHaveBeenCalledWith(discordMarkdown(recap, new Map([["p1", "Maya"]])))
})

it("discordMarkdown lays out the heading, body, quote and bullets", () => {
  expect(discordMarkdown(recap, new Map([["p1", "Maya"]]))).toBe(
    [
      "## Previously, at the Abbey…",
      "The tide turned.",
      "> “That's the clapper.” — Velis, 1:40:31",
      "- **Maya**: Cracked the riddle",
      "**Open questions**\n- Who rang the bell?",
    ].join("\n\n"),
  )
})

it("Save image renders the card at 2x and downloads it", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  open(true)
  await screen.findByText("The tide turned.")
  fireEvent.click(screen.getByRole("button", { name: /Save image/ }))
  await waitFor(() => expect(click).toHaveBeenCalled())
  expect(toPng).toHaveBeenCalledWith(expect.any(HTMLElement), { pixelRatio: 2 })
})

it("an unreviewed session shows the banner but still builds", async () => {
  open(false)
  const link = await screen.findByRole("link", { name: /Review session 1 first/ })
  expect(link).toHaveAttribute("href", "/sessions/s1/review")
  expect(screen.getByText("The tide turned.")).toBeInTheDocument()
})

it("a reviewed session has no banner", async () => {
  open(true)
  await screen.findByText("The tide turned.")
  expect(screen.queryByRole("link", { name: /Review/ })).toBeNull()
})
