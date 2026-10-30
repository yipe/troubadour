import { X } from "lucide-react"
import { useEffect, type ReactNode } from "react"
import { useSetAudioMonitor, type Grade } from "@troubadour/api/audio"
import { QUALITY_ROWS, useAudio, useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { cn } from "@troubadour/ui/cn"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"
import { LevelMeter48 } from "../../components/mic/LevelMeter48.tsx"

const GRADE_CLASS: Record<Grade, string> = { good: "text-success", ok: "text-warning", poor: "text-danger" }

/** The status line is the trigger; the popover holds the live level and quality read-out. */
export function QualityPopover({ children }: { children: ReactNode }) {
  const monitor = useLive((s) => s.session?.audio_monitor ?? true)
  const quality = useAudio((s) => s.quality.session)
  const setMonitor = useSetAudioMonitor()

  // Off means no new read-outs: drop the last one rather than show stale numbers when it comes back.
  useEffect(() => {
    if (!monitor) useAudio.setState((s) => ({ quality: { ...s.quality, session: undefined } }))
  }, [monitor])

  return (
    <Popover>
      <PopoverTrigger
        className="flex cursor-pointer items-center gap-1.5 rounded-control text-left hover:opacity-80"
        aria-label="Audio quality"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-13 font-semibold">Audio quality</span>
          {monitor && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto size-6 border-0 p-0"
              aria-label="Hide and stop monitoring"
              title="Hide and stop monitoring"
              disabled={setMonitor.isPending}
              onClick={() => setMonitor.mutate(false)}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        {!monitor ? (
          <Button size="sm" disabled={setMonitor.isPending} onClick={() => setMonitor.mutate(true)}>
            Show audio quality
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <LevelMeter48 source="session" />
            {quality ? (
              <>
                <ul className="flex flex-col gap-1 text-13">
                  {QUALITY_ROWS.map((row) => (
                    <li key={row.key} className="flex items-center gap-2">
                      <span className="flex-1 text-ink-muted">{row.label}</span>
                      <span className={cn("tabular-nums", GRADE_CLASS[quality.grades[row.key]])}>
                        {row.value(quality)}
                      </span>
                    </li>
                  ))}
                </ul>
                {quality.hints.map((h) => (
                  <p key={h} className="text-12 text-warning">
                    {h}
                  </p>
                ))}
                <p className="text-11 text-ink-subtle">Over the last {Math.round(quality.window_s)} s.</p>
              </>
            ) : (
              <p className="text-13 text-ink-subtle">
                Listening… the first read-out comes after a few seconds.
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
