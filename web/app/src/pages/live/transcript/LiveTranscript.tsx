import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useClasses } from "@troubadour/api/players"
import { useLive, useSpeaking } from "@troubadour/api/live"
import { TranscriptList } from "../../../components/transcript/TranscriptList.tsx"
import { toViewLines, type ViewLine } from "../../../components/transcript/viewLines.ts"
import { playerColor, speakerFor } from "../../../lib/players.ts"
import { AskBar } from "./AskBar.tsx"
import { LineSpeakerPicker } from "./LineSpeakerPicker.tsx"

export interface LiveTranscriptProps {
  /** Session second to scroll to and highlight (set by a notebook jump). */
  highlightT: number | null
  /** A line was pinned: the page switches the notebook to Pins. */
  onPinned: () => void
}

/** How long a line reached from an answer's source stays highlighted (as for a notebook jump). */
const HIGHLIGHT_MS = 2500

/** The line a moment falls in: the last one that had started by then. */
function lineAt(lines: ViewLine[], t: number | null): string | null {
  if (t === null) return null
  let found: ViewLine | undefined
  for (const l of lines) if (l.t <= t) found = l
  return found?.id ?? null
}

/** The live transcript with the ask bar under it. */
export function LiveTranscript({ highlightT, onPinned }: LiveTranscriptProps) {
  const messages = useLive((s) => s.messages)
  const voices = useLive((s) => s.voices)
  const players = useLive((s) => s.players)
  const speakingVoice = useSpeaking((s) => s.voiceId)
  const classes = useClasses().data ?? []
  const [answerT, setAnswerT] = useState<number | null>(null)
  const [picking, setPicking] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const lines = useMemo(
    () => toViewLines(messages, voices, players, classes),
    [messages, voices, players, classes],
  )
  const focusId = lineAt(lines, answerT ?? highlightT)

  const jumpFromAnswer = (t: number) => {
    clearTimeout(timer.current)
    setAnswerT(t)
    timer.current = setTimeout(() => setAnswerT(null), HIGHLIGHT_MS)
  }

  const speaker = speakingVoice ? speakerFor(speakingVoice, voices, players) : null
  const footer = speaker ? (
    <p
      className="flex items-center gap-2 px-7 py-1.5 text-13 text-ink-subtle"
      style={
        {
          "--player": speaker.player ? playerColor(speaker.player, classes) : "var(--color-fg-subtle)",
        } as CSSProperties
      }
    >
      <span aria-hidden className="size-1.5 rounded-full bg-(--player)" />
      {speaker.name} is speaking…
    </p>
  ) : null

  return (
    <>
      {lines.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-5 text-14 text-ink-subtle">
          Nothing said yet. The transcript fills in as people speak.
        </p>
      ) : (
        <TranscriptList
          lines={lines}
          mode="live"
          highlightId={focusId}
          scrollToId={focusId}
          footer={footer}
          onSpeakerClick={(line, anchor) =>
            setPicking({ id: line.id, anchor: anchor.getBoundingClientRect() })
          }
        />
      )}
      <AskBar onJump={jumpFromAnswer} onPinned={onPinned} />
      {picking ? (
        <LineSpeakerPicker messageId={picking.id} anchor={picking.anchor} onClose={() => setPicking(null)} />
      ) : null}
    </>
  )
}
