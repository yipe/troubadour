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
  const segments = talkSegments(talk, players, classes, order)
  return (
    <div className="flex flex-col gap-2">
      <SegmentedBar segments={segments} height={height} />
      {legend ? <SegmentedLegend segments={segments} /> : null}
    </div>
  )
}
