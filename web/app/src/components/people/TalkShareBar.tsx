import type { Player } from "@troubadour/api/players"
import { useClasses } from "@troubadour/api/players"
import { SegmentedBar, SegmentedLegend } from "@troubadour/ui/segmented-bar"
import { talkSegments } from "../../lib/talk.ts"

export type TalkShareBarProps = {
  /** player id -> seconds spoken */
  talk: Record<string, number>
  players: Player[]
  legend?: boolean
  height?: number
  /** "roster" keeps the players list's order; "share" puts the biggest share first ("Others" stays last). */
  order?: "roster" | "share"
}

export function TalkShareBar({ talk, players, legend = true, height, order = "roster" }: TalkShareBarProps) {
  const classes = useClasses().data ?? []
  const all = talkSegments(talk, players, classes)
  // talkSegments puts "Others" last, after one segment per player who spoke; sort only the players.
  // Array.sort is stable, so ties keep roster order.
  const named = players.filter((p) => (talk[p.id] ?? 0) > 0).length
  const segments =
    order === "share" ? [...all.slice(0, named).sort((a, b) => b.value - a.value), ...all.slice(named)] : all
  return (
    <div className="flex flex-col gap-2">
      <SegmentedBar segments={segments} height={height} />
      {legend ? <SegmentedLegend segments={segments} /> : null}
    </div>
  )
}
