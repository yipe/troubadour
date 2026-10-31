import { useMemo, useState, type CSSProperties } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { FileX } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useClasses } from "@troubadour/api/players"
import { useReview, useReviewAction } from "@troubadour/api/review"
import type { ReviewAction, ReviewItem } from "@troubadour/api/review"
import { useMarkReviewed, useSessionRecord, useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { EmptyState } from "@troubadour/ui/empty-state"
import { PillGroup } from "@troubadour/ui/pill-group"
import { Progress } from "@troubadour/ui/progress"
import { SectionLabel } from "@troubadour/ui/section-label"
import { Spinner } from "@troubadour/ui/spinner"
import { notify } from "@troubadour/ui/toast"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { useJob } from "../../components/jobs/useJob.ts"
import { TranscriptList } from "../../components/transcript/TranscriptList.tsx"
import { recordToViewLines, type ViewLine } from "../../components/transcript/viewLines.ts"
import { paths } from "../../paths.ts"
import {
  FILTERS,
  filterCounts,
  gmStatedOpen,
  lineState,
  matchesFilter,
  minutesLeft,
  placeItems,
  reviewDate,
  type Filter,
} from "./items.ts"
import { ReviewCard } from "./ReviewCard.tsx"

const ASIDE_WIDTH = 488 // the 460px column plus the 28px gap, which the aside pads itself

// A line with a note gets the accent wash and a 3px edge: accent while open, success once accepted.
// The aside tags itself with data-review; the list's row owns the line, so the style reaches it from here.
const LINE_STYLES = [
  "[&_[data-line-id]:has([data-review=open])>div:first-child]:bg-accent-soft",
  "[&_[data-line-id]:has([data-review=open])>div:first-child]:shadow-[inset_3px_0_0_var(--color-accent)]",
  "[&_[data-line-id]:has([data-review=accepted])>div:first-child]:bg-accent-soft",
  "[&_[data-line-id]:has([data-review=accepted])>div:first-child]:shadow-[inset_3px_0_0_var(--color-success)]",
].join(" ")

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

export function Component() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const review = useReview(id)
  const record = useSessionRecord(id)
  const sessions = useSessions().data
  const campaign = useCampaign().data
  const classData = useClasses().data
  const classes = useMemo(() => classData ?? [], [classData])
  const writeup = useJob("writeup", id)
  const action = useReviewAction(id)
  const markReviewed = useMarkReviewed(id)
  const [filter, setFilter] = useState<Filter>("all")
  const [confirming, setConfirming] = useState(false)
  const [accepting, setAccepting] = useState<{ at: number; of: number } | null>(null)

  const data = review.data
  const lines = useMemo(
    () => (record.data ? recordToViewLines(record.data, classes) : []),
    [record.data, classes],
  )
  const placement = useMemo(
    () =>
      placeItems(
        data?.items ?? [],
        lines.map((l) => l.id),
      ),
    [data?.items, lines],
  )
  const facts = useMemo(
    () => [...(campaign?.facts ?? []), ...(campaign?.entities ?? []).flatMap((e) => e.facts)],
    [campaign],
  )
  const entryNames = useMemo(() => (campaign?.entities ?? []).map((e) => e.name), [campaign])

  if (review.isError || record.isError) {
    return (
      <EmptyState
        icon={<FileX className="size-8" />}
        title="Couldn't load this review"
        body={(review.error ?? record.error)?.message}
        action={
          <Link to={paths.sessions()}>
            <Button>Back to sessions</Button>
          </Link>
        }
      />
    )
  }
  if (!data || !record.data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-14 text-ink-muted">
        <Spinner /> Loading review…
      </div>
    )
  }

  const summary = sessions?.find((s) => s.id === id)
  const started = summary?.started_at ?? record.data.session.started_at
  const label = summary?.n ? `Session ${summary.n}` : "Session"
  const title = summary?.title || label
  const { done, total } = data.counts
  const open = total - done
  const counts = filterCounts(data.items)
  const gmOpen = gmStatedOpen(data.items)

  const act = (itemId: string, body: ReviewAction) => action.mutateAsync({ itemId, ...body })

  async function acceptAllGm() {
    for (const [i, item] of gmOpen.entries()) {
      setAccepting({ at: i + 1, of: gmOpen.length })
      notify(`Accepting ${i + 1} of ${gmOpen.length}…`, { duration: 1500 })
      try {
        await act(item.id, { action: "accept" })
      } catch (e) {
        notify(`Stopped at ${i + 1} of ${gmOpen.length}: ${e instanceof Error ? e.message : String(e)}`, {
          tone: "danger",
        })
        setAccepting(null)
        return
      }
    }
    setAccepting(null)
    notify(`Accepted ${plural(gmOpen.length, "GM-stated fact")}`)
  }

  async function finish() {
    try {
      await markReviewed.mutateAsync(true)
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t mark the review done.", { tone: "danger" })
      return
    }
    notify(`${label} reviewed`)
    void navigate(paths.session(id))
  }

  const card = (item: ReviewItem) => (
    <ReviewCard key={item.id} item={item} entryNames={entryNames} facts={facts} act={act} />
  )

  function renderAside(line: ViewLine) {
    const all = placement.byLine.get(line.id)
    const shown = all?.filter((i) => matchesFilter(i, filter))
    if (!all || !shown?.length) return null
    return (
      <div data-review={lineState(all)} className="flex flex-col gap-2 pt-0.5 pb-2 pl-10 lg:pl-7">
        {shown.map(card)}
      </div>
    )
  }

  const loose = placement.loose.filter((i) => matchesFilter(i, filter))
  const footer =
    loose.length > 0 ? (
      <section className="px-5 pt-4 pb-6">
        <SectionLabel>{data.written_up ? "Not tied to a line" : "From the live notebook"}</SectionLabel>
        <div className="mt-2 flex max-w-[460px] flex-col gap-2">{loose.map(card)}</div>
      </section>
    ) : null

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:min-h-0">
      <header className="flex flex-none flex-wrap items-center gap-4 border-b border-line px-5 py-3.5 md:px-7">
        <div>
          <div className="text-12 text-ink-subtle">
            Review · {label}
            {typeof started === "number" ? ` · ${reviewDate(started)}` : ""}
          </div>
          <h1 className="font-serif text-22 leading-tight font-bold text-ink">{title}</h1>
        </div>
        <div className="flex w-[220px] flex-col gap-1.5 lg:ml-6">
          <div className="flex text-12 text-ink-subtle">
            <span>
              {done} of {total} reviewed
            </span>
            {open > 0 ? <span className="ml-auto">~{minutesLeft(open)} min left</span> : null}
          </div>
          <Progress value={total > 0 ? done / total : 0} tone="success" />
        </div>
        <PillGroup
          className="lg:ml-3"
          value={filter}
          onChange={(f) => setFilter(f as Filter)}
          items={FILTERS.map((f) => ({ ...f, count: counts[f.id] }))}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button disabled={gmOpen.length === 0 || accepting !== null} onClick={() => void acceptAllGm()}>
            {accepting
              ? `Accepting ${accepting.at} of ${accepting.of}…`
              : `Accept all GM-stated (${gmOpen.length})`}
          </Button>
          <Button
            variant="primary"
            disabled={markReviewed.isPending}
            onClick={() => (open > 0 ? setConfirming(true) : void finish())}
          >
            Finish review
          </Button>
        </div>
      </header>

      {!data.written_up ? (
        <div className="flex flex-none items-center gap-3 border-b border-line bg-warning-soft px-7 py-2.5 text-13">
          <span className="font-semibold text-ink">
            {writeup.active ? "The write-up is still running" : "This session isn’t written up yet"}
          </span>
          {writeup.job ? <JobStatus job={writeup.job} variant="inline" /> : null}
          <span className="ml-auto text-ink-muted">Only what the live notebook kept is here for now.</span>
        </div>
      ) : null}

      <div
        className="grid flex-none grid-cols-1 gap-0 px-5 pt-3 lg:grid-cols-[minmax(0,1fr)_var(--aside-w)]"
        style={{ "--aside-w": `${ASIDE_WIDTH}px` } as CSSProperties}
      >
        <SectionLabel className="px-2 pb-2.5">Transcript</SectionLabel>
        <SectionLabel className="hidden pb-2.5 pl-7 lg:block">Suggestions on these lines</SectionLabel>
      </div>

      <div className={`flex h-[75dvh] flex-none flex-col lg:min-h-0 lg:flex-1 ${LINE_STYLES}`}>
        {lines.length === 0 && loose.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-14 text-ink-muted">
            Nothing to review in this session.
          </p>
        ) : (
          <TranscriptList
            lines={lines}
            mode="static"
            renderAside={renderAside}
            asideWidth={ASIDE_WIDTH}
            footer={footer}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Finish the review?"
        body={`${plural(open, "suggestion")} ${open === 1 ? "is" : "are"} still open. They stay in the codex as suggestions.`}
        confirmLabel="Finish review"
        tone="primary"
        onConfirm={finish}
      />
    </div>
  )
}
