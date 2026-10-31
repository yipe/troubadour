import type { ReactNode } from "react"
import { DprcalcMark } from "./dprcalc-mark"
import { DropdownMenuSeparator } from "./dropdown-menu"

/** The top of the account menu: who is signed in, and that the account is DPRcalc's. */
export function AccountSummary({
  name,
  email,
  avatar,
}: {
  name?: string | null
  email?: string | null
  avatar: ReactNode
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        {avatar}
        <div className="min-w-0">
          <p className="truncate text-13 font-semibold text-ink">{name ?? email ?? "Signed in"}</p>
          {name && email ? <p className="truncate text-12 text-ink-muted">{email}</p> : null}
        </div>
      </div>
      <p className="flex items-center gap-1.5 px-2.5 pb-1.5 text-12 text-ink-muted">
        <DprcalcMark className="size-3.5" /> Signed in with DPRcalc
      </p>
      <DropdownMenuSeparator />
    </>
  )
}
