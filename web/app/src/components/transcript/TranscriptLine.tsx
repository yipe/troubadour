import type { CSSProperties } from "react"
import { cn } from "@troubadour/ui/cn"
import { hms } from "../../lib/format.ts"
import { FixedText } from "./FixedText.tsx"
import type { ViewLine } from "./viewLines.ts"

export type TranscriptLineProps = {
  line: ViewLine
  highlighted?: boolean
  /** Makes the timestamp a button (seek the audio, find the line). */
  onTimestamp?: (line: ViewLine) => void
  /** Makes the speaker name a button; `anchor` is the element to place a popover against. */
  onSpeakerClick?: (line: ViewLine, anchor: HTMLElement) => void
  /** Rendered after the text, e.g. a "Name this voice" link. */
  aside?: React.ReactNode
}

export function TranscriptLine({
  line,
  highlighted,
  onTimestamp,
  onSpeakerClick,
  aside,
}: TranscriptLineProps) {
  const { speaker, label, text, fixes, unsure } = line
  const time = hms(line.t)
  const timeClass = "pt-[3px] text-left font-mono text-12 text-ink-subtle tabular-nums"
  const nameStyle = speaker ? ({ "--player": speaker.color } as CSSProperties) : undefined
  const nameClass = "font-bold text-(--player)"
  return (
    <div
      className={cn(
        "grid grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-md px-2 py-[5px] transition-colors duration-300",
        highlighted && "animate-flash bg-accent-soft ring-1 ring-accent-strong ring-inset",
      )}
    >
      {onTimestamp ? (
        <button
          type="button"
          title="Play from here"
          className={cn(timeClass, "hover:text-ink hover:underline")}
          onClick={() => onTimestamp(line)}
        >
          {time}
        </button>
      ) : (
        <span className={timeClass}>{time}</span>
      )}
      <div className="text-15 leading-[1.55] text-pretty">
        {speaker ? (
          <>
            {onSpeakerClick ? (
              <button
                type="button"
                style={nameStyle}
                className={cn(nameClass, "cursor-pointer hover:underline")}
                onClick={(e) => onSpeakerClick(line, e.currentTarget)}
              >
                {speaker.name}
              </button>
            ) : (
              <b style={nameStyle} className={nameClass}>
                {speaker.name}
              </b>
            )}
            {speaker.as ? <span className="text-13 text-ink-subtle"> as {speaker.as}</span> : null}{" "}
            <span className={cn(unsure && "text-ink-muted italic")}>
              <FixedText text={text} fixes={fixes} />
            </span>
          </>
        ) : (
          <>
            {label ? (
              onSpeakerClick ? (
                <button
                  type="button"
                  className="cursor-pointer text-ink-subtle italic hover:underline"
                  onClick={(e) => onSpeakerClick(line, e.currentTarget)}
                >
                  {label}
                </button>
              ) : (
                <span className="text-ink-subtle italic">{label}</span>
              )
            ) : null}{" "}
            <span className="text-ink-subtle italic">
              <FixedText text={text} fixes={fixes} />
            </span>
          </>
        )}
        {aside ? <> {aside}</> : null}
      </div>
    </div>
  )
}
