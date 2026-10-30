import { cn } from "@troubadour/ui/cn"
import type { Appearances } from "@troubadour/api/timeline"

/** Opacity step by mentions: 1, 2-3, 4 or more. */
function shade(count: number): string {
  if (count >= 4) return "opacity-100"
  if (count >= 2) return "opacity-70"
  return "opacity-40"
}

/** One square per session, oldest first, lit where the entry was named. Nothing until the data is in. */
export function MentionBits({
  data,
  name,
  item,
}: {
  data: Appearances | undefined
  name: string
  item: boolean
}) {
  if (!data || data.sessions.length === 0) return null
  const counts = data.counts[name] ?? data.sessions.map(() => 0)
  const lit = counts.filter((c) => c > 0).length
  return (
    <span
      role="img"
      aria-label={`Mentioned in ${lit} of ${data.sessions.length} sessions`}
      className="mt-1 flex flex-wrap gap-px whitespace-normal"
    >
      {data.sessions.map((s, i) => {
        const count = counts[i] ?? 0
        return (
          <span
            key={s.id}
            data-testid="mention-bit"
            data-count={count}
            title={`S${s.n}: ${count} ${count === 1 ? "mention" : "mentions"}`}
            className={cn(
              "size-[3px] shrink-0",
              count === 0 ? "bg-line" : cn(item ? "bg-legendary" : "bg-accent", shade(count)),
            )}
          />
        )
      })}
    </span>
  )
}
