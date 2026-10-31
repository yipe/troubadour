import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cn } from "../lib/cn"
import { Avatar } from "./avatar"
import { Button } from "./button"
import { Gallery } from "../gallery/index"

afterEach(cleanup)

describe("Button", () => {
  it.each(["primary", "secondary", "ghost", "danger", "warning", "link"] as const)(
    "renders the %s variant and passes onClick",
    async (variant) => {
      const onClick = vi.fn()
      render(
        <Button variant={variant} onClick={onClick}>
          Go
        </Button>,
      )
      await userEvent.click(screen.getByRole("button", { name: "Go" }))
      expect(onClick).toHaveBeenCalledOnce()
    },
  )

  it("keeps a link free of the size's height and padding, unless the caller sets them", () => {
    render(
      <>
        <Button variant="link" size="sm">
          Plain
        </Button>
        <Button variant="link" className="px-2">
          Padded
        </Button>
      </>,
    )
    const plain = screen.getByRole("button", { name: "Plain" }).className.split(" ")
    expect(plain).toEqual(expect.arrayContaining(["h-auto", "p-0"]))
    expect(plain).not.toEqual(expect.arrayContaining(["h-7"]))
    expect(plain).not.toEqual(expect.arrayContaining(["px-2.5"]))
    expect(screen.getByRole("button", { name: "Padded" }).className.split(" ")).toContain("px-2")
  })
})

describe("Avatar", () => {
  it("exposes the colour as --avatar", () => {
    render(<Avatar initials="AB" color="var(--color-class-bard)" />)
    expect(screen.getByText("AB").style.getPropertyValue("--avatar")).toBe("var(--color-class-bard)")
  })
})

describe("cn", () => {
  it("keeps a custom text size next to a text colour", () => {
    expect(cn("text-14", "text-ink")).toBe("text-14 text-ink")
  })
})

describe("Gallery", () => {
  it("renders the base section", () => {
    render(<Gallery />)
    expect(screen.getByRole("heading", { name: "Base" })).toBeInTheDocument()
  })
})
