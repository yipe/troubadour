import { Link } from "react-router"
import { UserPlus } from "lucide-react"
import { useClasses, type Player } from "@troubadour/api/players"
import type { Voice } from "@troubadour/api/session"
import { Card, CardHeader } from "@troubadour/ui/card"
import { PlayerAvatar } from "../../components/people/PlayerAvatar.tsx"
import { playerColor } from "../../lib/players.ts"
import { useTableName } from "../../lib/table.ts"
import { paths } from "../../paths.ts"

type VoiceStatus = "Trained" | "Learned in play" | "No voice yet"

function voiceStatus(player: Player, voices: Voice[]): VoiceStatus {
  if (player.trained) return "Trained"
  return voices.some((v) => v.status === "named" && v.player_id === player.id)
    ? "Learned in play"
    : "No voice yet"
}

/** The GM's NPC voices are the named voices that carry a character. */
function npcVoices(player: Player, voices: Voice[]): number {
  return voices.filter((v) => v.status === "named" && v.player_id === player.id && v.character).length
}

export type TheTableProps = { players: Player[]; voices: Voice[] }

export function TheTable({ players, voices }: TheTableProps) {
  const classes = useClasses().data ?? []
  const title = useTableName()
  const label = (p: Player) => classes.find((c) => c.id === p.dnd_class)?.label ?? null

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader title={title} />
      {players.map((p) => {
        const color = playerColor(p, classes)
        const npcs = npcVoices(p, voices)
        const role = p.is_gm
          ? ["GM", npcs > 0 ? `${npcs} NPC ${npcs === 1 ? "voice" : "voices"}` : null]
          : [label(p)]
        const status = voiceStatus(p, voices)
        return (
          <div key={p.id} className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5">
            <PlayerAvatar player={p} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold" style={{ color }}>
                {p.is_gm ? "Game master" : p.character || p.name}
              </div>
              <div className="truncate text-12 text-ink-subtle">
                {[p.name, role.filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span
              className={`text-12 whitespace-nowrap ${status === "Trained" ? "text-success" : "text-ink-subtle"}`}
            >
              {status}
            </span>
          </div>
        )
      })}
      <Link
        to={paths.settings("players")}
        className="flex items-center gap-1.5 px-4 py-3 text-13 text-ink-subtle hover:text-ink"
      >
        <UserPlus className="size-3.5" />
        Add a player or a guest
      </Link>
    </Card>
  )
}
