import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ArrowDown } from "lucide-react"
import { Button } from "@troubadour/ui/button"
import { TranscriptLine, type TranscriptLineProps } from "./TranscriptLine.tsx"
import type { ViewLine } from "./viewLines.ts"

export type TranscriptListProps = Pick<TranscriptLineProps, "onTimestamp" | "onSpeakerClick" | "onStop"> & {
  /** Session seconds of the timestamp that is playing; its line shows a stop button. */
  playingT?: number | null
  lines: ViewLine[]
  /** live follows the newest line; static (a saved session) starts at the top. */
  mode: "live" | "static"
  highlightId?: string | null
  /** Scrolls to this line and centres it. */
  scrollToId?: string | null
  /** Change it to scroll to `scrollToId` again, e.g. when the line is already the target. */
  scrollNonce?: number
  /** Content on the same row as its line, in a column `asideWidth` wide. */
  renderAside?: (line: ViewLine) => ReactNode
  asideWidth?: number
  /** After the last row, e.g. "Orsa is speaking…". */
  footer?: ReactNode
}

type Context = { footer?: ReactNode }

/** Breathing room at the top, and the footer after the last row. */
function Header() {
  return <div className="h-3" />
}
function Footer({ context }: { context?: Context }) {
  return <div className="min-h-3">{context?.footer}</div>
}

export function TranscriptList({
  lines,
  mode,
  highlightId,
  scrollToId,
  scrollNonce,
  renderAside,
  asideWidth = 460,
  footer,
  onTimestamp,
  onStop,
  playingT,
  onSpeakerClick,
}: TranscriptListProps) {
  const ref = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const live = mode === "live"
  const hasLines = lines.length > 0

  // Belt and braces: land on the newest line once the list has real layout.
  useEffect(() => {
    if (!live || !hasLines) return
    const id = requestAnimationFrame(() => ref.current?.scrollToIndex({ index: "LAST", align: "end" }))
    return () => cancelAnimationFrame(id)
  }, [live, hasLines])

  useEffect(() => {
    if (!scrollToId) return
    const index = lines.findIndex((l) => l.id === scrollToId)
    if (index >= 0) ref.current?.scrollToIndex({ index, align: "center" })
    // Only a new target scrolls; new lines arriving must not drag the view back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId, scrollNonce])

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso<ViewLine, Context>
        ref={ref}
        // A definite size from the first paint: with h-full inside flex the list mounted at 0 px tall.
        style={{ position: "absolute", inset: 0 }}
        data={lines}
        context={{ footer }}
        computeItemKey={(_, l) => l.id}
        initialTopMostItemIndex={live && hasLines ? lines.length - 1 : 0}
        alignToBottom={live}
        // Stick to the bottom only while the user is already there.
        followOutput={live ? (isAtBottom) => (isAtBottom ? "auto" : false) : false}
        atBottomThreshold={48}
        atBottomStateChange={setAtBottom}
        increaseViewportBy={400}
        components={{ Header, Footer }}
        itemContent={(_, line) => {
          const row = (
            <TranscriptLine
              line={line}
              highlighted={line.id === highlightId}
              onTimestamp={onTimestamp}
              onStop={onStop}
              playing={playingT != null && line.t === playingT}
              onSpeakerClick={onSpeakerClick}
            />
          )
          return (
            <div
              data-line-id={line.id}
              aria-current={line.id === highlightId ? "true" : undefined}
              // The aside sits under its line until there is room for it beside the line.
              className={
                renderAside ? "grid grid-cols-1 px-5 lg:grid-cols-[minmax(0,1fr)_var(--aside-w)]" : "px-5"
              }
              style={renderAside ? ({ "--aside-w": `${asideWidth}px` } as CSSProperties) : undefined}
            >
              {row}
              {renderAside ? <div className="min-w-0">{renderAside(line)}</div> : null}
            </div>
          )
        }}
      />
      {live && !atBottom && (
        <Button
          size="sm"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-lg"
          onClick={() => ref.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" })}
        >
          <ArrowDown /> Jump to latest
        </Button>
      )}
    </div>
  )
}
