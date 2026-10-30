import { useEffect, useRef, useState } from "react"
import { EndSessionDialog } from "./end/EndSessionDialog.tsx"
import { Notebook } from "./notebook/Notebook.tsx"
import { SpeakerRail } from "./SpeakerRail.tsx"
import { LiveTranscript } from "./transcript/LiveTranscript.tsx"

/** How long a jumped-to line stays highlighted. */
const HIGHLIGHT_MS = 2500

/** Speakers on the left, the transcript in the middle, tonight's notebook on the right. */
export function LivePage() {
  const [highlightT, setHighlightT] = useState<number | null>(null)
  const [tab, setTab] = useState("facts")
  const [ending, setEnding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const jump = (t: number) => {
    clearTimeout(timer.current)
    setHighlightT(t)
    timer.current = setTimeout(() => setHighlightT(null), HIGHLIGHT_MS)
  }

  return (
    <div className="flex h-full min-h-0">
      <SpeakerRail onEnd={() => setEnding(true)} />
      <section className="flex min-w-0 flex-1 flex-col">
        <LiveTranscript highlightT={highlightT} onPinned={() => setTab("pins")} />
      </section>
      <aside className="flex min-h-0 w-[440px] flex-none flex-col border-l border-line bg-sunken">
        <Notebook onJump={jump} tab={tab} onTabChange={setTab} />
      </aside>
      <EndSessionDialog open={ending} onOpenChange={setEnding} />
    </div>
  )
}
