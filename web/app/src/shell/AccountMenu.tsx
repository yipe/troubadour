import { useLive } from "@troubadour/api/live"
import { initials } from "../lib/players.ts"

/** Placeholder at the final size (the GM's initials); S13 adds the menu. */
export function AccountMenu() {
  const gm = useLive((s) => s.players.find((p) => p.is_gm))
  return (
    <button
      type="button"
      aria-label="Account"
      className="flex size-[30px] items-center justify-center rounded-full bg-elevated text-12 font-bold text-ink-muted"
    >
      {gm ? initials(gm.name) : "?"}
    </button>
  )
}
