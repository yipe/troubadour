import { fireEvent, screen, waitFor } from "@testing-library/react"
import { useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cloudAccount, cloudStatus, mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../test/render.tsx"
import { AccountMenu } from "./AccountMenu.tsx"

const PICTURE = "data:image/png;base64,AAAA"

afterEach(() => vi.restoreAllMocks())

function serve(
  connected: boolean,
  account = cloudAccount({ email: "gm@example.com", name: "gm", avatar: PICTURE }),
) {
  return mockFetch((call) => {
    if (call.url === "/api/cloud") return cloudStatus({ connected, url: "https://cloud.test" })
    if (call.url === "/api/cloud/account") return account
    if (call.url === "/api/cloud/connect") return { authorize_url: "https://auth.test/oauth/authorize?x=1" }
    if (call.url === "/api/cloud/disconnect") return cloudStatus({ connected: false })
  })
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

async function openMenu() {
  renderWithProviders(
    <>
      <AccountMenu />
      <Where />
    </>,
  )
  await waitFor(() => expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "Account" }))
  await screen.findByRole("menuitem", { name: "Settings" })
}

describe("AccountMenu", () => {
  it("shows the DPRcalc account's avatar, name, email and links once connected", async () => {
    const { writes } = serve(true)
    await openMenu()
    expect(await screen.findByText("gm@example.com")).toBeInTheDocument()
    expect(screen.getByText("gm")).toBeInTheDocument()
    expect(screen.getByText(/Signed in with DPRcalc/)).toBeInTheDocument()
    expect(document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull()
    expect(screen.getByRole("menuitem", { name: /Open Troubadour Cloud/ })).toHaveAttribute(
      "href",
      "https://cloud.test/vaults",
    )
    expect(screen.getByRole("menuitem", { name: /Manage on DPRcalc/ })).toHaveAttribute(
      "href",
      "https://accounts.dprcalc.com/user",
    )
    expect(writes()).toEqual([])
  })

  it("falls back to the initial and the address for a sign-in without a profile", async () => {
    serve(true, cloudAccount({ email: "gm@example.com" }))
    await openMenu()
    expect((await screen.findAllByText("gm@example.com")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("G").length).toBeGreaterThan(0)
    expect(document.querySelector("img")).toBeNull()
  })

  it("signed out, offers Sign in and never asks for the account", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() }
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    const { writes, calls } = serve(false)
    await openMenu()
    expect(screen.queryByText("Disconnect cloud")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign in with DPRcalc" }))
    await waitFor(() => expect(tab.location.href).toBe("https://auth.test/oauth/authorize?x=1"))
    expect(writes()).toEqual([{ method: "POST", url: "/api/cloud/connect", body: undefined }])
    expect(calls.map((c) => c.url)).not.toContain("/api/cloud/account")
  })

  it.each([
    ["Settings", "/settings/models"],
    ["Players & voices", "/settings/players"],
    ["Troubadour Cloud", "/settings/cloud"],
  ])("the %s item goes to %s", async (name, path) => {
    serve(false)
    await openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name }))
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(path))
  })

  it("Disconnect asks first, then forgets the account", async () => {
    const { writes } = serve(true)
    await openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect cloud" }))
    await screen.findByText("Disconnect Troubadour Cloud?")
    expect(writes()).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    await waitFor(() =>
      expect(writes()).toEqual([{ method: "POST", url: "/api/cloud/disconnect", body: undefined }]),
    )
  })
})
