import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { Route, Routes, useLocation } from "react-router"
import { keys } from "@troubadour/api/query"
import { campaign, entity, mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../test/render.tsx"
import { Component as CodexPage } from "../index.tsx"

afterEach(() => vi.restoreAllMocks())

const orsa = entity({
  name: "Orsa Vell",
  type: "npc",
  aliases: ["The Captain"],
  heard_as: ["Orsa Bell"],
  heard_as_suggested: ["Orsa Fell"],
})
const debt = entity({ name: "Gull's Debt", type: "item" })
const locked = entity({ name: "Locked Note", read_only: true })

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function page(route = "/codex/Orsa%20Vell") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/codex/:entry" element={<CodexPage />} />
      </Routes>
      <Where />
    </>,
    {
      route,
      queryData: [
        [keys.campaign(), campaign({ entities: [orsa, debt, locked] })],
        [[...keys.campaign(), ...keys.entity("Orsa Vell")], { ...orsa, appearances: [] }],
        [[...keys.campaign(), ...keys.entity("Locked Note")], { ...locked, appearances: [] }],
      ],
    },
  )
}

const edit = () => userEvent.click(screen.getByRole("button", { name: "Edit" }))

it("renaming saves and moves the URL to the new name", async () => {
  const renamed = { ...orsa, name: "Orsa Vale" }
  const { writes } = mockFetch(({ method, url }) => {
    if (method === "PATCH") return renamed
    if (method === "GET" && url.endsWith("/campaign")) return campaign({ entities: [renamed, debt, locked] })
    return undefined
  })
  page()
  await edit()
  const dialog = screen.getByRole("dialog")
  const name = within(dialog).getByLabelText("Name")
  await userEvent.clear(name)
  await userEvent.type(name, "Orsa Vale")
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toEqual({ name: "Orsa Vale" })
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/codex/Orsa%20Vale"))
})

it("saves alias and heard-as changes as new lists", async () => {
  const { writes } = mockFetch(({ method, body }) =>
    method === "PATCH" ? { ...orsa, ...(body as object) } : undefined,
  )
  page()
  await edit()
  const dialog = screen.getByRole("dialog")
  await userEvent.type(within(dialog).getByLabelText("Add alias"), "Gull{Enter}")
  await userEvent.click(
    within(within(dialog).getByRole("group", { name: "spelling" })).getByLabelText("Remove"),
  )
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toEqual({ aliases: ["The Captain", "Gull"], heard_as: [] })
})

it("merges after confirming and opens the target", async () => {
  const { writes } = mockFetch(({ method }) =>
    method === "POST" ? { ...debt, aliases: ["Orsa Vell"] } : undefined,
  )
  page()
  await edit()
  await userEvent.click(screen.getByRole("button", { name: /Merge into/ }))
  await userEvent.click(await screen.findByRole("option", { name: /Gull's Debt/ }))
  expect(writes()).toHaveLength(0)
  await userEvent.click(screen.getByRole("button", { name: "Merge" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.url).toContain("merge")
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/codex/Gull's%20Debt"))
})

it("deletes after confirming and leaves the page", async () => {
  const { writes } = mockFetch(() => undefined)
  page()
  await edit()
  await userEvent.click(screen.getByRole("button", { name: "Delete" }))
  expect(screen.getByText(/Moves the note to \.trash\//)).toBeInTheDocument()
  expect(writes()).toHaveLength(0)
  const confirm = screen.getAllByRole("dialog").at(-1)!
  await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.method).toBe("DELETE")
  await waitFor(() => expect(screen.getByTestId("where")).not.toHaveTextContent("Orsa"))
})

it("accepts and rejects a suggested spelling through the review endpoint", async () => {
  const { writes } = mockFetch(({ method }) =>
    method === "POST" ? { ...orsa, heard_as_suggested: [] } : undefined,
  )
  page()
  await userEvent.click(screen.getByRole("button", { name: "Accept" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.url).toContain("review")
  expect(writes()[0]?.body).toEqual({ accept_spellings: ["Orsa Fell"] })
})

it("rejects a suggested spelling", async () => {
  const { writes } = mockFetch(({ method }) =>
    method === "POST" ? { ...orsa, heard_as_suggested: [] } : undefined,
  )
  page()
  await userEvent.click(screen.getByRole("button", { name: "Reject" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toEqual({ reject_spellings: ["Orsa Fell"] })
})

it("disables the form for a read-only note", async () => {
  mockFetch(() => undefined)
  page("/codex/Locked%20Note")
  await edit()
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).getByRole("status")).toHaveTextContent("Fix it in Obsidian")
  expect(within(dialog).getByLabelText("Name")).toBeDisabled()
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled()
})
