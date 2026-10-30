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
