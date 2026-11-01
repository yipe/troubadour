import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import type { QueryClient } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { keys } from "@troubadour/api/query"
import { bodyOf, campaign, campaignJob, entity, mockFetch } from "@troubadour/api/testing"
import { describe, expect, it } from "vitest"
import { renderWithProviders } from "../../test/render.tsx"
import { appendFiles } from "./appendFiles.ts"
import { ImportNotes } from "./ImportNotes.tsx"

const seeded = (jobs = [] as ReturnType<typeof campaignJob>[]): [unknown, unknown][] => [
  [keys.campaign(), campaign({ entities: [entity({ name: "Mira" })], jobs })],
]

/** What a `campaign.job` event does: the job in the cache changes state. */
function finishJob(client: QueryClient, job: ReturnType<typeof campaignJob>) {
  act(() => {
    client.setQueryData(keys.campaign(), campaign({ entities: [entity({ name: "Mira" })], jobs: [job] }))
  })
}

describe("ImportNotes", () => {
  it("keeps Import disabled while the paste is empty", async () => {
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    const button = screen.getByRole("button", { name: /^Import$/ })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Notes"), "  ")
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Notes"), "Mira met a dragon")
    expect(button).toBeEnabled()
  })

  it("posts the title and text, then shows the job's created names as links", async () => {
    const queued = campaignJob({ id: "j1", state: "queued", title: "Notes" })
    const done = campaignJob({ id: "j1", state: "done", created: ["Mira"], updated: [], suggested: 2 })
    const api = mockFetch(() => queued)
    const { client } = renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Mira met a dragon")
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes()).toHaveLength(1))
    await screen.findByText("Waiting for another job…")
    finishJob(client, done)
    const link = await screen.findByRole("link", { name: "Mira" })
    expect(link).toBeInTheDocument()
    expect(screen.getByText(/2 suggested/)).toBeInTheDocument()
    const post = api.writes()[0]!
    expect(post.url).toBe("/api/campaign/import")
    expect(bodyOf(post)).toEqual({ title: "Imported notes", text: "Mira met a dragon" })
  })

  it("lists the sessions found in a paste and sends the edited dates and titles", async () => {
    const found = {
      sessions: [
        { n: 1, date: "2026-09-14", title: "The Road", preview: "We left." },
        { n: 2, date: null, title: null, preview: "Rested." },
      ],
      more: 0,
      background: null,
      background_chars: 0,
    }
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview" ? found : campaignJob({ id: "j3", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Session 1\nWe left.\nSession 2\nRested.")
    expect(await screen.findByText(/Found 2 sessions/)).toBeInTheDocument()
    // The row without a date starts unknown until one is picked.
    expect(screen.getByRole("checkbox", { name: "Session 2 date unknown" })).toBeChecked()
    fireEvent.change(screen.getByLabelText("Session 2 date"), { target: { value: "2026-09-21" } })
    fireEvent.change(screen.getByLabelText("Session 1 title"), { target: { value: "The Long Road" } })
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    const post = api.writes().find((c) => c.url === "/api/campaign/import")!
    expect(bodyOf(post)).toMatchObject({
      sessions: [
        { index: 0, date: "2026-09-14", title: "The Long Road" },
        { index: 1, date: "2026-09-21", title: null },
      ],
    })
  })

  it("sends undated sessions with an unknown date, can mark them all unknown, and warns of sessions past the limit", async () => {
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview"
        ? {
            sessions: [
              { n: 1, date: null, title: null, preview: "a" },
              { n: 2, date: "2026-09-21", title: null, preview: "b" },
            ],
            more: 3,
            background: null,
            background_chars: 0,
          }
        : campaignJob({ id: "j5", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Session 1\na\nSession 2\nb")
    expect(await screen.findByText(/3 more sessions were found/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    expect(bodyOf(api.writes().find((c) => c.url === "/api/campaign/import")!)).toMatchObject({
      sessions: [
        { index: 0, date: null },
        { index: 1, date: "2026-09-21" },
      ],
    })
  })

  it("Mark every date unknown moves the dated ones too", async () => {
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview"
        ? {
            sessions: [
              { n: 1, date: "2026-09-14", title: null, preview: "a" },
              { n: 2, date: "2026-09-21", title: null, preview: "b" },
            ],
            more: 0,
            background: null,
            background_chars: 0,
          }
        : campaignJob({ id: "j6", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Session 1\na\nSession 2\nb")
    await userEvent.click(await screen.findByRole("button", { name: "Mark every date unknown" }))
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    expect(bodyOf(api.writes().find((c) => c.url === "/api/campaign/import")!)).toMatchObject({
      sessions: [
        { index: 0, date: null },
        { index: 1, date: null },
      ],
    })
  })

  it("reads what comes before the first session as background notes, unless unticked", async () => {
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview"
        ? {
            sessions: [
              { n: 1, date: null, title: null, preview: "a" },
              { n: 2, date: null, title: null, preview: "b" },
            ],
            more: 0,
            background: "Cast list",
            background_chars: 1846,
          }
        : campaignJob({ id: "j8", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Cast\nSession I\na\nSession II\nb")
    expect(await screen.findByText(/1,846 characters before the first session/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    expect(bodyOf(api.writes().find((c) => c.url === "/api/campaign/import")!)).toMatchObject({
      background: true,
    })
  })

  it("imports as plain notes when the Timeline option is off", async () => {
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview"
        ? {
            sessions: [{ n: 1, date: "2026-09-14", title: null, preview: "x" }],
            more: 0,
            background: null,
            background_chars: 0,
          }
        : campaignJob({ id: "j4", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Session 1\nx\nSession 2\ny")
    await userEvent.click(await screen.findByRole("checkbox", { name: "Add them to the Timeline" }))
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    expect(bodyOf(api.writes().find((c) => c.url === "/api/campaign/import")!)).not.toHaveProperty("sessions")
  })

  it("lists the sessions found in a paste and sends the edited dates and titles", async () => {
    const found = {
      sessions: [
        { n: 1, date: "2026-09-14", title: "The Road", preview: "We left." },
        { n: 2, date: null, title: null, preview: "Rested." },
      ],
      more: 0,
      background: null,
      background_chars: 0,
    }
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview" ? found : campaignJob({ id: "j3", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Session 1")
    expect(await screen.findByText(/Found 2 sessions/)).toBeInTheDocument()
    // The row without a date starts unknown until one is picked.
    expect(screen.getByRole("checkbox", { name: "Session 2 date unknown" })).toBeChecked()
    fireEvent.change(screen.getByLabelText("Session 2 date"), { target: { value: "2026-09-21" } })
    fireEvent.change(screen.getByLabelText("Session 1 title"), { target: { value: "The Long Road" } })
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    const post = api.writes().find((c) => c.url === "/api/campaign/import")!
    expect(bodyOf(post)).toMatchObject({
      sessions: [
        { index: 0, date: "2026-09-14", title: "The Long Road" },
        { index: 1, date: "2026-09-21", title: null },
      ],
    })
  })

  it("imports as plain notes when the Timeline option is off", async () => {
    const api = mockFetch((c) =>
      c.url === "/api/campaign/import/preview"
        ? {
            sessions: [{ n: 1, date: "2026-09-14", title: null, preview: "x" }],
            more: 0,
            background: null,
            background_chars: 0,
          }
        : campaignJob({ id: "j4", state: "queued" }),
    )
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Session 1")
    await userEvent.click(await screen.findByRole("checkbox", { name: "Add them to the Timeline" }))
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes().some((c) => c.url === "/api/campaign/import")).toBe(true))
    expect(bodyOf(api.writes().find((c) => c.url === "/api/campaign/import")!)).not.toHaveProperty("sessions")
  })

  it("shows a failed import inline", async () => {
    const api = mockFetch(() => campaignJob({ id: "j2", state: "queued" }))
    const { client } = renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "x")
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes()).toHaveLength(1))
    await screen.findByText("Waiting for another job…")
    finishJob(client, campaignJob({ id: "j2", state: "error", message: "Model unavailable" }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Model unavailable"))
  })

  it("dismissing a failed import keeps the pasted notes", async () => {
    const api = mockFetch(() => campaignJob({ id: "j3", state: "queued" }))
    const { client } = renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    await userEvent.type(screen.getByLabelText("Notes"), "Mira met a dragon")
    await userEvent.click(screen.getByRole("button", { name: /^Import$/ }))
    await waitFor(() => expect(api.writes()).toHaveLength(1))
    await screen.findByText("Waiting for another job…")
    finishJob(client, campaignJob({ id: "j3", state: "error", message: "Model unavailable" }))
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByLabelText("Notes")).toHaveValue("Mira met a dragon")
  })

  it("fills the textarea from chosen files with file-name headings", async () => {
    renderWithProviders(<ImportNotes />, { queryData: seeded() as never })
    const files = [
      new File(["one"], "a.md", { type: "text/markdown" }),
      new File(["two"], "b.md", { type: "text/markdown" }),
    ]
    fireEvent.change(screen.getByTestId("import-files"), { target: { files } })
    await waitFor(() => expect(screen.getByLabelText("Notes")).toHaveValue("# a.md\n\none\n\n# b.md\n\ntwo"))
  })
})

describe("appendFiles", () => {
  it("keeps what was already pasted ahead of the files", async () => {
    expect(await appendFiles("pasted", [new File(["x"], "n.md")])).toBe("pasted\n\n# n.md\n\nx")
  })
})
