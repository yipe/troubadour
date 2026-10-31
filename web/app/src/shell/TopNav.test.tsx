import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { session } from "@troubadour/api/testing"
import { renderWithProviders } from "../test/render.tsx"
import { AiStatus } from "./AiStatus.tsx"
import { TopNav } from "./TopNav.tsx"

describe("TopNav", () => {
  it("lists the tabs and marks Sessions active on a session's review", () => {
    renderWithProviders(<TopNav />, {
      route: "/sessions/12/review",
      live: { session: session({ status: "idle" }) },
    })
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Home",
      "Sessions",
      "Timeline",
      "Codex",
      "Facts",
      "Ask",
    ])
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "false")
  })

  it("marks Home active only at the root and no tab on settings", () => {
    const { unmount } = renderWithProviders(<TopNav />, { route: "/" })
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true")
    unmount()
    renderWithProviders(<TopNav />, { route: "/settings/models" })
    for (const tab of screen.getAllByRole("tab")) expect(tab).toHaveAttribute("aria-selected", "false")
  })

  it("shows the recording pill and the red dot only while a session runs", () => {
    const { unmount } = renderWithProviders(<TopNav />, { live: { session: session({ status: "idle" }) } })
    expect(screen.queryByText("RECORDING")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Recording")).not.toBeInTheDocument()
    unmount()

    const running = renderWithProviders(<TopNav />, { live: { session: session({ t: 6128 }) } })
    expect(screen.getByRole("link", { name: /RECORDING/ })).toHaveAttribute("href", "/sessions/live")
    expect(screen.getByText("1:42:08")).toBeInTheDocument()
    expect(screen.getByLabelText("Recording")).toBeInTheDocument()
    running.unmount()

    renderWithProviders(<TopNav />, { live: { session: session({ status: "paused", t: 65 }) } })
    expect(screen.getByText("PAUSED")).toBeInTheDocument()
    expect(screen.getByText("0:01:05")).toBeInTheDocument()
  })
})

describe("AiStatus", () => {
  const llm = (provider: "local" | "openai") =>
    [
      keys.llm(),
      {
        provider,
        providers: [
          {
            id: "openai",
            label: "ChatGPT",
            sign_in: true,
            manage_url: "",
            connected: true,
            account: null,
            known_account: null,
          },
        ],
      },
    ] as [readonly string[], unknown]

  it("says AI ready only when both models are up", () => {
    const up = renderWithProviders(<AiStatus />, { live: { session: session() }, queryData: [llm("local")] })
    expect(screen.getByText("AI ready")).toBeInTheDocument()
    expect(screen.getByText("On this computer")).toBeInTheDocument()
    up.unmount()

    const noLlm = renderWithProviders(<AiStatus />, {
      live: { session: session({ llm: { url: "", model: "", ok: false } }) },
    })
    expect(screen.queryByText("AI ready")).not.toBeInTheDocument()
    expect(screen.getByText("AI off")).toBeInTheDocument()
    noLlm.unmount()

    const loading = renderWithProviders(<AiStatus />, {
      live: { session: session({ asr: { model: "w", state: "loading" } }) },
    })
    expect(screen.getByText("AI loading")).toBeInTheDocument()
    loading.unmount()

    renderWithProviders(<AiStatus />, { live: { session: session({ asr: { model: "w", state: "error" } }) } })
    expect(screen.getByText("AI off")).toBeInTheDocument()
  })

  it("names a hosted provider instead of saying On this computer, and opens Models", () => {
    renderWithProviders(<AiStatus />, { live: { session: session() }, queryData: [llm("openai")] })
    expect(screen.getByText("ChatGPT")).toBeInTheDocument()
    expect(screen.queryByText("On this computer")).not.toBeInTheDocument()
    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings/models")
  })
})
