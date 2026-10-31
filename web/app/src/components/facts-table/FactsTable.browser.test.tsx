import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { makeQueryClient } from "@troubadour/api/query"
import { fact, mockFetch } from "@troubadour/api/testing"
import "../../index.css"
import { FactsTable } from "./FactsTable.tsx"

let unmount = () => {}
afterEach(() => {
  unmount()
  document.body.innerHTML = ""
})

// Pages scroll inside the shell's <main>, not the window; this pins that the windowed table still follows them.
describe("FactsTable, windowed", () => {
  it("renders the last rows when its scrolling column (not the window) is scrolled to the end", async () => {
    mockFetch((c) => (c.url === "/api/sessions" || c.url === "/api/classes" ? [] : undefined))
    const rows = Array.from({ length: 400 }, (_, i) => ({ fact: fact({ text: `Fact number ${i + 1}` }) }))
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    root.render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          {/* the app shell's <main>: the page scrolls here, the window doesn't */}
          <main data-testid="scroller" style={{ height: 600, overflowY: "auto" }}>
            <FactsTable rows={rows} emptyText="None" />
          </main>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    unmount = () => root.unmount()
    await expect.element(page.getByText("Fact number 1", { exact: true })).toBeInTheDocument()
    const scroller = document.querySelector<HTMLElement>("[data-testid=scroller]")!
    scroller.scrollTop = scroller.scrollHeight
    await expect.element(page.getByText("Fact number 400", { exact: true })).toBeInTheDocument()
  })
})
