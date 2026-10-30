import type { Appearance } from "@troubadour/api/campaign"
import { SectionLabel } from "@troubadour/ui/section-label"

const BAR_AREA_PX = 44

/** Mentions per session: a bar per session, a baseline tick where the entry was never named. */
export function AppearancesChart({ appearances }: { appearances: Appearance[] | null | undefined }) {
  if (!appearances || appearances.length === 0) return null
  const max = Math.max(1, ...appearances.map((a) => a.count))
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <SectionLabel>Appearances</SectionLabel>
        <span className="text-12 text-ink-subtle">mentions per session</span>
      </div>
      <ol className="flex gap-1.5 rounded-card border border-line bg-surface px-3 pt-3 pb-2">
        {appearances.map((a) => (
          <li
            key={a.session_id}
            data-testid="appearance"
            title={`Session ${a.n}: ${a.count} ${a.count === 1 ? "mention" : "mentions"}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <div className="flex w-full items-end" style={{ height: BAR_AREA_PX }}>
              <div
                className={a.count > 0 ? "w-full rounded-t-[2px] bg-accent-strong" : "h-px w-full bg-line"}
                style={a.count > 0 ? { height: Math.max(3, (a.count / max) * BAR_AREA_PX) } : undefined}
              />
            </div>
            <span className="font-mono text-11 text-ink-subtle">S{a.n}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
