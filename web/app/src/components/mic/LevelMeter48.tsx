import { useEffect, useRef, useState } from "react"
import type { AudioSource } from "@troubadour/api/audio"
import { subscribeLevel } from "@troubadour/api/live"
import { BAR_CLASS, barHeight, barZone, emptyBars, pushBar, type Bar } from "./meterBars.ts"

/**
 * 48 bars of recent input level, newest on the right. Level events arrive about ten times a second;
 * they land in a ref and become one new bar per animation frame at most.
 */
export function LevelMeter48({
  source,
  className,
  hint = "Say a few words from each seat",
}: {
  source: AudioSource
  className?: string
  /** The middle caption: the mic test's instruction by default; null during a session. */
  hint?: string | null
}) {
  const [bars, setBars] = useState<Bar[]>(emptyBars)
  const pending = useRef<{ db: number | null } | null>(null)
  const frame = useRef(0)

  useEffect(() => {
    const unsubscribe = subscribeLevel(source, (level) => {
      pending.current = { db: level.db }
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        const next = pending.current
        pending.current = null
        if (next) setBars((b) => pushBar(b, next.db))
      })
    })
    return () => {
      unsubscribe()
      cancelAnimationFrame(frame.current)
      frame.current = 0
      pending.current = null
    }
  }, [source])

  const last = bars[bars.length - 1] ?? null
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`.trim()}>
      <div
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={-70}
        aria-valuemax={0}
        aria-valuenow={last == null ? -70 : Math.round(last)}
        aria-valuetext={last == null ? "No signal" : `${Math.round(last)} dBFS`}
        className="flex h-9 items-end gap-[3px]"
      >
        {bars.map((db, i) => (
          <span
            key={i}
            data-bar={i}
            data-zone={barZone(db)}
            className={`flex-1 rounded-[2px] transition-[height] duration-100 ${BAR_CLASS[barZone(db)]}`}
            style={{ height: `${barHeight(db)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-11 text-ink-subtle">
        <span>quiet</span>
        {hint && <span>{hint}</span>}
        <span>clipping</span>
      </div>
    </div>
  )
}
