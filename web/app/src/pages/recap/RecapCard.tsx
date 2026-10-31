import type { CSSProperties, Ref } from "react"
import type { Recap } from "@troubadour/api/recap"
import { LuteIcon } from "../../components/brand/LuteIcon.tsx"
import { PlayerAvatar } from "../../components/people/PlayerAvatar.tsx"
import { hms } from "../../lib/format.ts"

export type CardPlayer = { id: string; name: string; color: string }

export type RecapCardProps = {
  recap: Recap
  /** "The Sunken Crown · Session 12": the campaign and session, as computed. */
  label: string
  players: CardPlayer[]
  cardRef: Ref<HTMLDivElement>
}

const asVar = (color: string) => ({ "--player": color }) as CSSProperties

/** The share image: what "Save image" renders. Fixed 620px so the PNG looks the same on any screen. */
export function RecapCard({ recap, label, players, cardRef }: RecapCardProps) {
  const byId = new Map(players.map((p) => [p.id, p]))
  const quoteColor = (recap.quote && byId.get(recap.quote.player_id)?.color) || "var(--color-fg-subtle)"
  return (
    <div
      ref={cardRef}
      className="w-[620px] overflow-hidden rounded-dialog border border-line-strong bg-canvas shadow-popover"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-[30px] pt-[26px] pb-[18px]">
        <LuteIcon size={18} className="text-accent" />
        <span className="text-12 font-bold tracking-[0.1em] text-ink-subtle uppercase">{label}</span>
      </div>
      <div className="flex flex-col gap-3.5 px-[30px] pt-[22px] pb-1.5">
        <h2 className="font-serif text-34 leading-[1.15] font-bold text-ink">{recap.title}</h2>
        <p className="font-serif text-[17px] leading-[1.6] whitespace-pre-line text-ink-muted">
          {recap.body}
        </p>
        {recap.quote && (
          <blockquote
            style={asVar(quoteColor)}
            className="rounded-r-card border-l-[3px] border-(--player) bg-surface px-[18px] py-3.5"
          >
            <p className="font-serif text-[19px] italic">“{recap.quote.text}”</p>
            <footer className="mt-1 text-12 text-ink-subtle">
              {recap.quote.speaker}, {hms(recap.quote.t)}
            </footer>
          </blockquote>
        )}
      </div>
      {recap.moments.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 px-[30px] pt-3 pb-[26px]">
          {recap.moments.map((m) => {
            const p = byId.get(m.player_id)
            const color = p?.color ?? "var(--color-fg-subtle)"
            return (
              <li key={m.player_id} className="flex items-center gap-2.5 rounded-card bg-surface px-3 py-2.5">
                <PlayerAvatar name={p?.name ?? "?"} color={color} size={36} />
                <div className="min-w-0 leading-[1.3]">
                  <div style={asVar(color)} className="text-13 font-bold text-(--player)">
                    {p?.name ?? "Someone"}
                  </div>
                  <div className="text-12 text-ink-muted">{m.text}</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex border-t border-line px-[30px] py-3 text-12 text-ink-subtle">
        <span className="ml-auto">Made with Troubadour</span>
      </div>
    </div>
  )
}
