import { X } from "lucide-react"
import { useState, type KeyboardEvent } from "react"
import { useAsk, type AnswerSource, type CampaignAnswer } from "@troubadour/api/ask"
import { useCampaign } from "@troubadour/api/campaign"
import { sessionTimeNow, useLive } from "@troubadour/api/live"
import { useAddPin } from "@troubadour/api/notebook"
import { useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { notify } from "@troubadour/ui/toast"
import { AskAnswer } from "../../../components/ask/AskAnswer.tsx"
import { hms } from "../../../lib/format.ts"

export interface AskBarProps {
  /** Scroll to and highlight the line at this session time (a source from tonight). */
  onJump: (t: number) => void
  /** A note was pinned: the page switches the notebook to Pins. */
  onPinned: () => void
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[4px] border border-line bg-surface px-1.5 py-px font-mono text-11 text-ink-subtle">
      {children}
    </kbd>
  )
}

/** The answer shown while the request itself is in flight, before the server has sent one. */
const searching = (question: string): CampaignAnswer => ({
  id: "pending",
  question,
  state: "searching",
  answer: "",
  found: false,
  sources: [],
  message: "",
  created: 0,
  campaign: null,
  t: null,
  stats: null,
})

/**
 * The saved session being recorded now: the newest one, while a session is running. The live
 * session has no id of its own, but the server saves it under one, and that is what sources cite.
 */
function useCurrentSessionId(): string | null {
  const status = useLive((s) => s.session?.status ?? "idle")
  const sessions = useSessions().data
  if (status === "idle" || !sessions?.length) return null
  return sessions.reduce((a, b) => (b.started_at > a.started_at ? b : a)).id
}

/**
 * Ask a question (ending in "?") or type a note to pin at the current time. Answers appear above the
 * bar and are never saved as facts.
 */
export function AskBar({ onJump, onPinned }: AskBarProps) {
  const [text, setText] = useState("")
  const [question, setQuestion] = useState<string | null>(null)
  const [answerId, setAnswerId] = useState<string | null>(null)
  const ask = useAsk()
  const addPin = useAddPin()
  const campaign = useCampaign()
  const currentSession = useCurrentSessionId()

  // The pending answer arrives from the mutation; `campaign.answer` events then update the cached copy.
  const answer: CampaignAnswer | null =
    question === null
      ? null
      : ask.isError
        ? { ...searching(question), state: "error", message: ask.error.message }
        : (answerId && campaign.data?.answers.find((a) => a.id === answerId)) ||
          ask.data ||
          searching(question)

  const close = () => {
    setQuestion(null)
    setAnswerId(null)
  }

  const submit = () => {
    const value = text.trim()
    if (!value) return
    const t = sessionTimeNow()
    setText("")
    if (value.endsWith("?")) {
      setQuestion(value)
      setAnswerId(null)
      ask.mutate({ question: value, t }, { onSuccess: (a) => setAnswerId(a.id) })
    } else {
      addPin.mutate({ t, text: value }, { onError: (e) => notify(e.message, { tone: "danger" }) })
      notify(`Pinned at ${hms(t)}`)
      onPinned()
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && question !== null) close()
  }

  const openSource = (source: AnswerSource) => {
    if (source.kind === "transcript" && source.session === currentSession && source.t !== null) {
      onJump(source.t)
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-2 px-5 pt-2 pb-4">
      {answer ? (
        <section
          aria-label="Answer"
          className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto rounded-card border border-line bg-surface p-4"
        >
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-15 font-semibold text-pretty text-ink">{answer.question}</p>
            <Button variant="ghost" size="sm" aria-label="Close answer" onClick={close}>
              <X aria-hidden />
            </Button>
          </div>
          <AskAnswer answer={answer} compact onSource={openSource} />
        </section>
      ) : null}
      <label className="flex h-11 items-center gap-3 rounded-control border border-line-strong bg-sunken px-3.5 focus-within:border-accent-strong">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
          placeholder="Ask a question (end with ?) or type a note to pin at the current time"
          aria-label="Ask a question or pin a note"
          className="min-w-0 flex-1 bg-transparent text-14 text-ink outline-none placeholder:text-ink-subtle"
        />
        <Kbd>Enter</Kbd>
      </label>
    </div>
  )
}
