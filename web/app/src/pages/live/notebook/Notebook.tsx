import { NotebookPen, Play } from "lucide-react"
import type { EntityType } from "@troubadour/api/campaign"
import { useClasses } from "@troubadour/api/players"
import { useLive } from "@troubadour/api/live"
import {
  useNotebook,
  useSetNotebookStatus,
  type NotebookItem,
  type NotebookStatus,
  type Pin,
} from "@troubadour/api/notebook"
import { Spinner } from "@troubadour/ui/spinner"
import { notify } from "@troubadour/ui/toast"
import { UnderlineTabs } from "@troubadour/ui/underline-tabs"
import { SuggestionCard, type SuggestionKind } from "../../../components/suggestion/SuggestionCard.tsx"
import { hms } from "../../../lib/format.ts"
import { playerColor } from "../../../lib/players.ts"

export interface NotebookProps {
  /** Jump the transcript to a session second. */
  onJump: (t: number) => void
  tab: string
  onTabChange: (tab: string) => void
}

const KEEP_LABEL: Record<NotebookItem["kind"], string> = {
  fact: "Keep",
  update: "Keep update",
  entry: "Add to codex",
  spelling: "OK",
}
const NAME_KINDS: ReadonlyArray<NotebookItem["kind"]> = ["entry", "spelling"]
const EMPTY = {
  facts: "Nothing new yet. Facts show up a few minutes after they're said.",
  names: "Nothing new yet. Facts show up a few minutes after they're said.",
  pins: "Type a note in the bar below and press Enter to pin it to the current moment.",
}

// An item with no time (the model could not place it) sorts last.
const newestFirst = <T extends { t: number | null }>(rows: T[]) =>
  [...rows].sort((a, b) => (b.t ?? -1) - (a.t ?? -1))

/** A timestamp that scrolls the live transcript; the card's own link would open a saved session. */
function JumpButton({ t, onJump }: { t: number; onJump: (t: number) => void }) {
  return (
    <button
      type="button"
      className="mr-auto inline-flex cursor-pointer items-center gap-1 font-mono text-12 text-accent hover:underline"
      onClick={() => onJump(t)}
    >
      <Play aria-hidden className="size-3 fill-current" />
      {hms(t)}
    </button>
  )
}

const actionClass =
  "cursor-pointer rounded-control px-2 py-[3px] text-12 font-semibold text-ink bg-elevated hover:brightness-110"
const dismissClass = "cursor-pointer rounded-control px-1.5 py-[3px] text-12 text-ink-subtle hover:text-ink"

/** Tonight's notebook: what the model noticed so far, for the GM to keep or dismiss. */
export function Notebook({ onJump, tab, onTabChange }: NotebookProps) {
  const notebook = useNotebook().data
  const setStatus = useSetNotebookStatus()
  const players = useLive((s) => s.players)
  const classes = useClasses().data ?? []

  const visible = (notebook?.items ?? []).filter((i) => i.status !== "dismissed")
  const facts = newestFirst(visible.filter((i) => !NAME_KINDS.includes(i.kind)))
  const names = newestFirst(visible.filter((i) => NAME_KINDS.includes(i.kind)))
  const pins = newestFirst(notebook?.pins ?? [])
  const kept = visible.filter((i) => i.status === "kept").length

  const change = (id: string, status: NotebookStatus) => setStatus.mutate({ id, status })
  const dismiss = (id: string) => {
    change(id, "dismissed")
    notify("Dismissed", { undo: () => change(id, "open") })
  }

  const whoFor = (said: NotebookItem["said_by"]) => {
    if (!said) return undefined
    const p = players.find((x) => x.id === said.player_id)
    return { name: said.name, color: p ? playerColor(p, classes) : "var(--color-fg-subtle)" }
  }

  const card = (i: NotebookItem) => {
    const done = i.status === "kept"
    return (
      <SuggestionCard
        key={i.id}
        kind={i.kind as SuggestionKind}
        about={i.about ?? undefined}
        entryType={(i.entry_type as EntityType | null) ?? undefined}
        text={i.text}
        old={i.old ?? undefined}
        confidence={i.confidence ?? undefined}
        who={whoFor(i.said_by)}
        status={done ? "done" : "open"}
        actions={
          <>
            {i.t !== null ? <JumpButton t={i.t} onJump={onJump} /> : null}
            {done ? (
              <span className="font-semibold text-success">✓ Kept</span>
            ) : (
              <>
                <button type="button" className={actionClass} onClick={() => change(i.id, "kept")}>
                  {KEEP_LABEL[i.kind]}
                </button>
                <button type="button" className={dismissClass} onClick={() => dismiss(i.id)}>
                  Dismiss
                </button>
              </>
            )}
          </>
        }
      />
    )
  }

  const pinCard = (p: Pin) => (
    <SuggestionCard
      key={p.id}
      kind="pin"
      text={p.text}
      who={{ name: "Pinned by you", color: "var(--color-fg-subtle)" }}
      status="open"
      actions={<JumpButton t={p.t} onJump={onJump} />}
    />
  )

  const shown = tab === "pins" ? pins.map(pinCard) : (tab === "names" ? names : facts).map(card)

  return (
    <>
      <div className="flex flex-col gap-3 px-[18px] pt-3.5">
        <div className="flex items-center gap-2">
          <NotebookPen aria-hidden className="size-4 text-ink-muted" />
          <div className="font-serif text-16 font-semibold">Tonight's notebook</div>
          {notebook?.updating ? <Spinner className="size-3.5" /> : null}
          <span className="ml-auto text-12 text-ink-subtle">
            {kept > 0 ? `${kept} kept for review` : "kept facts go to the review"}
          </span>
        </div>
        <UnderlineTabs
          value={tab}
          onChange={onTabChange}
          items={[
            { id: "facts", label: "Facts", count: facts.length },
            { id: "names", label: "Names", count: names.length },
            { id: "pins", label: "Pins", count: pins.length },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-[18px] py-3.5">
        {shown.length > 0 ? (
          shown
        ) : (
          <p className="p-6 text-center text-13 text-ink-subtle">{EMPTY[tab as keyof typeof EMPTY]}</p>
        )}
      </div>
    </>
  )
}
