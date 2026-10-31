import { Link } from "react-router"
import { Inbox } from "lucide-react"
import type { Review } from "@troubadour/api/review"
import { Button } from "@troubadour/ui/button"
import { IconTile } from "@troubadour/ui/icon-tile"
import { paths } from "../../paths.ts"
import { openByKind } from "./data.ts"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export type ReviewBannerProps = { sessionId: string; n: number; review: Review }

/** Shown while the last session has suggestions nobody has decided on. */
export function ReviewBanner({ sessionId, n, review }: ReviewBannerProps) {
  if (review.counts.total - review.counts.done <= 0) return null
  const open = openByKind(review.items)
  const parts = [
    open.fact > 0 && plural(open.fact, "fact"),
    open.spelling > 0 && plural(open.spelling, "spelling"),
    open.entry > 0 && plural(open.entry, "new entry", "new entries"),
  ].filter(Boolean)
  return (
    <div className="flex items-center gap-4 rounded-card border border-warning/40 bg-warning-soft px-5 py-4">
      <IconTile tone="warning" size={36}>
        <Inbox className="size-5" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">Session {n} is waiting for review</div>
        <div className="text-13 text-ink-muted">{parts.join(" · ")}, found by the local model</div>
      </div>
      <Button variant="warning" size="lg" nativeButton={false} render={<Link to={paths.review(sessionId)} />}>
        Start review
      </Button>
    </div>
  )
}
