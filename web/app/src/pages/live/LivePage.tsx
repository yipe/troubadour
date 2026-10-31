import { useEffect, useRef, useState } from "react"
import { cn } from "@troubadour/ui/cn"
import { EndSessionDialog } from "./end/EndSessionDialog.tsx"
import { Notebook } from "./notebook/Notebook.tsx"
import { SpeakerRail } from "./SpeakerRail.tsx"
import { LiveTranscript } from "./transcript/LiveTranscript.tsx"

/** How long a jumped-to line stays highlighted. */
const HIGHLIGHT_MS = 2500

/**
 * Speakers on the left, the transcript in the middle, tonight's notebook on the right. Below `xl` the
 * notebook shares the middle with the transcript behind a two-way switch (the transcript is the default,
 * and never hidden by anything else); below `lg` the speakers sit on top and the page scrolls as one.
 */
export function LivePage() {
  const [highlightT, setHighlightT] = useState<number | null>(null)
  const [tab, setTab] = useState("facts")
  const [ending, setEnding] = useState(false)
  const [pane, setPane] = useState<"transcript" | "notebook">("transcript")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const jump = (t: number) => {
    clearTimeout(timer.current)
    setHighlightT(t)
    timer.current = setTimeout(() => setHighlightT(null), HIGHLIGHT_MS)
  }

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:min-h-0 lg:flex-row">
      <SpeakerRail onEnd={() => setEnding(true)} />
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0 xl:flex-row">
        <div className="flex border-b border-line xl:hidden">
          {(["transcript", "notebook"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={pane === p}
              onClick={() => setPane(p)}
              className={cn(
                "flex-1 cursor-pointer border-b-2 py-2.5 text-14 capitalize",
                pane === p
                  ? "border-accent-strong font-semibold text-ink"
                  : "border-transparent text-ink-subtle",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <section
          className={cn(
            "h-[75dvh] min-w-0 flex-col lg:h-auto lg:min-h-0 lg:flex-1",
            pane === "transcript" ? "flex" : "hidden xl:flex",
          )}
        >
          <LiveTranscript highlightT={highlightT} onPinned={() => setTab("pins")} />
        </section>
        <aside
          className={cn(
            "h-[75dvh] min-h-0 flex-col bg-sunken lg:h-auto lg:flex-1 xl:w-[440px] xl:flex-none xl:border-l xl:border-line",
            pane === "notebook" ? "flex" : "hidden xl:flex",
          )}
        >
          <Notebook onJump={jump} tab={tab} onTabChange={setTab} />
        </aside>
      </div>
      <EndSessionDialog open={ending} onOpenChange={setEnding} />
    </div>
  )
}
