import { Link } from "react-router"
import { Check, UserPlus } from "lucide-react"
import { useClasses } from "@troubadour/api/players"
import type { Player } from "@troubadour/api/players"
import { Avatar } from "@troubadour/ui/avatar"
import { cn } from "@troubadour/ui/cn"
import { initials, playerColor } from "../../lib/players.ts"
import { paths } from "../../paths.ts"

export type WhoIsHereProps = {
  players: Player[]
  absent: ReadonlySet<string>
  onToggle: (id: string) => void
}

export function WhoIsHere({ players, absent, onToggle }: WhoIsHereProps) {
  const classes = useClasses().data ?? []
  const here = players.filter((p) => !absent.has(p.id)).length
  const ok = here > 0

  return (
    <section
      aria-label="Who's here tonight"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface px-[18px] py-4"
    >
      <div className="flex items-center gap-2.5">
        <span
          data-testid="here-status"
          className={cn(
            "flex size-[22px] items-center justify-center rounded-full text-12 font-bold",
            ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
          )}
        >
          {ok ? <Check className="size-3" aria-hidden /> : "!"}
        </span>
        <h3 className="font-bold">Who&rsquo;s here tonight?</h3>
        <span className="ml-auto text-13 text-ink-subtle">
          {here} of {players.length} · tap to toggle
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {players.map((p) => {
          const away = absent.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={!away}
              onClick={() => onToggle(p.id)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-full border py-2 pr-3.5 pl-2 text-left",
                away ? "border-line bg-transparent opacity-50" : "bg-subtle border-line-strong",
              )}
            >
              <Avatar
                initials={initials(p.name)}
                color={playerColor(p, classes)}
                src={p.avatar ?? undefined}
              />
              <span className="leading-tight">
                <span className="block text-13 font-semibold">
                  {p.is_gm ? "Game master" : p.character || p.name}
                </span>
                <span className="block text-11 text-ink-subtle">
                  {p.name}
                  {away ? " · away tonight" : ""}
                </span>
              </span>
            </button>
          )
        })}
        <Link
          to={paths.settings("players")}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5 text-13 text-ink-subtle hover:text-ink"
        >
          <UserPlus className="size-3.5" aria-hidden />
          Guest
        </Link>
      </div>
    </section>
  )
}
