import { useState } from "react"
import { Plus, Users } from "lucide-react"
import { useLive } from "@troubadour/api/live"
import { useCreatePlayer, useSeatPlayer } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { notify } from "@troubadour/ui/toast"
import { PlayerRow, ROW_GRID } from "./PlayerRow.tsx"

/** "Sam", "Sam and Jo", "Sam, Jo and Rin". */
function joinNames(names: string[]): string {
  if (names.length < 2) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * The seated players, one row each. The wizard and Settings show the same table; `mode` is for
 * the caller's own layout and doesn't change it.
 */
export function PlayersTable({ mode }: { mode: "wizard" | "settings" }) {
  const players = useLive((s) => s.players)
  const library = useLive((s) => s.library)
  const create = useCreatePlayer()
  const seat = useSeatPlayer()
  const [focusId, setFocusId] = useState<string | null>(null)

  const trainedElsewhere = library.filter((p) => p.trained)

  const add = () =>
    create.mutate(
      { name: "New player", is_gm: players.length === 0 },
      { onSuccess: (p) => setFocusId(p.id), onError: (e) => notify(e.message, { tone: "danger" }) },
    )

  const addAll = () => {
    for (const p of trainedElsewhere)
      seat.mutate({ id: p.id }, { onError: (e) => notify(e.message, { tone: "danger" }) })
  }

  return (
    <div className="flex flex-col gap-4" data-mode={mode}>
      {trainedElsewhere.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-card border border-accent-strong/40 bg-accent-soft px-3.5 py-3 text-14">
          <Users className="size-4 text-accent" />
          <span className="flex-1">
            {trainedElsewhere.length} {trainedElsewhere.length === 1 ? "player" : "players"} from your other
            campaigns already {trainedElsewhere.length === 1 ? "has a trained voice" : "have trained voices"}.
          </span>
          <Button disabled={seat.isPending} onClick={addAll}>
            Add {joinNames(trainedElsewhere.map((p) => p.name))}
          </Button>
        </div>
      )}
      <div role="table" aria-label="Players" className="overflow-hidden rounded-card border border-line">
        <div
          role="row"
          className={`${ROW_GRID} bg-sunken py-2.5 text-12 font-semibold tracking-wider text-ink-subtle uppercase`}
        >
          <span />
          <span role="columnheader">Player</span>
          <span role="columnheader">Character</span>
          <span role="columnheader">Class</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Voice</span>
          <span />
        </div>
        {players.map((p) => (
          <PlayerRow key={p.id} player={p} focus={p.id === focusId} />
        ))}
        <button
          type="button"
          disabled={create.isPending}
          onClick={add}
          className="flex w-full cursor-pointer items-center gap-2 border-t border-dashed border-line-strong bg-surface px-4 py-3 text-13 font-semibold text-accent hover:bg-elevated"
        >
          <Plus className="size-3.5" /> Add player
        </button>
      </div>
    </div>
  )
}
