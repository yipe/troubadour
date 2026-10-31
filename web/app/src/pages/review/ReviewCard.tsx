import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import type { Fact } from "@troubadour/api/campaign"
import type { ReviewAction, ReviewItem } from "@troubadour/api/review"
import { Button } from "@troubadour/ui/button"
import { Textarea } from "@troubadour/ui/textarea"
import { SuggestionCard, type SuggestionCardProps } from "../../components/suggestion/SuggestionCard.tsx"
import { paths } from "../../paths.ts"
import { AboutPicker } from "./AboutPicker.tsx"
import { NamePicker } from "./NamePicker.tsx"
import { replacedText } from "./items.ts"

export type ReviewCardProps = {
  item: ReviewItem
  /** Names of the codex entries a fact can be moved to. */
  entryNames: string[]
  /** Confirmed facts, to show what an update replaces. */
  facts: Fact[]
  /** Decide the item; rejects with the server's message. */
  act: (itemId: string, body: ReviewAction) => Promise<unknown>
}

/** What the card shows apart from its actions. */
function cardProps(
  item: ReviewItem,
  facts: Fact[],
): Omit<SuggestionCardProps, "status" | "tone" | "actions"> {
  if (item.kind === "spelling" && item.spelling) {
    const { heard, entity, count } = item.spelling
    return {
      kind: "spelling",
      about: entity ?? undefined,
      text: entity
        ? `“${heard}” → ${entity} · Fixed in ${count} ${count === 1 ? "line" : "lines"}`
        : `“${heard}” · Unknown word`,
    }
  }
  if (item.kind === "entry" && item.entry) {
    return { kind: "entry", about: item.entry.name, entryType: item.entry.type, text: item.entry.description }
  }
  const f = item.fact
  const old = replacedText(f?.replaces ?? null, facts)
  return {
    kind: f?.kind === "update" ? "update" : "fact",
    about: f?.about ?? "Campaign facts",
    text: f?.text ?? "",
    old,
    confidence: f?.confidence,
  }
}

/** One review item as the margin note beside its line. */
export function ReviewCard({ item, entryNames, facts, act }: ReviewCardProps) {
  const [mode, setMode] = useState<"view" | "edit" | "name">("view")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState(item.fact?.text ?? "")
  const [about, setAbout] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState("")

  async function decide(body: ReviewAction) {
    setBusy(true)
    setError(null)
    try {
      await act(item.id, body)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const accept = () => decide({ action: "accept" })
  const reject = () => decide({ action: "reject" })

  const props = cardProps(item, facts)
  if (item.status !== "open") {
    const accepted = item.status === "accepted"
    return (
      <SuggestionCard
        {...props}
        status="done"
        tone={accepted ? "accepted" : "default"}
        actions={
          accepted ? (
            <span className="text-13 font-semibold text-success">✓ Accepted</span>
          ) : (
            <span className="text-13 text-ink-subtle">Rejected</span>
          )
        }
      />
    )
  }

  const primary = (label: string, onClick: () => void) => (
    <Button size="sm" variant="primary" disabled={busy} onClick={onClick}>
      {label}
    </Button>
  )
  const rejectButton = (
    <Button size="sm" variant="link" className="px-2 text-ink-subtle" disabled={busy} onClick={reject}>
      Reject
    </Button>
  )
  let actions: ReactNode
  if (mode !== "view") {
    actions = null
  } else if (item.kind === "fact") {
    actions = (
      <>
        {primary("Accept", accept)}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("edit")}>
          Edit
        </Button>
        {rejectButton}
      </>
    )
  } else if (item.kind === "spelling") {
    actions = (
      <>
        {item.spelling?.entity
          ? primary("Accept", accept)
          : primary("Choose the name", () => setMode("name"))}
        {item.spelling?.entity ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("name")}>
            Change…
          </Button>
        ) : null}
        {rejectButton}
      </>
    )
  } else {
    actions = (
      <>
        {primary("Add to codex", accept)}
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link to={paths.codex(item.entry?.name)} />}
        >
          Edit
        </Button>
        {rejectButton}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <SuggestionCard {...props} status="open" actions={actions} />
      {item.preaccepted && mode === "view" ? (
        <p className="px-1 text-12 text-ink-subtle">Kept during the session</p>
      ) : null}
      {mode === "edit" ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
          <Textarea aria-label="Fact text" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2 text-13 text-ink-muted">
            About
            <AboutPicker
              value={about === undefined ? (item.fact?.about ?? null) : about}
              names={entryNames}
              onChange={setAbout}
            />
          </div>
          <div className="flex gap-2">
            {primary("Accept with edits", () =>
              !text.trim()
                ? undefined
                : decide({
                    action: "accept",
                    text: text.trim(),
                    ...(about === undefined ? {} : { about }),
                  }),
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {mode === "name" ? (
        <form
          className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void decide({ action: "accept", text: name.trim() })
          }}
        >
          <div className="flex flex-col gap-1 text-13 text-ink-muted">
            What “{item.spelling?.heard}” should be
            <NamePicker
              heard={item.spelling?.heard ?? ""}
              entryNames={entryNames}
              value={name}
              onChange={setName}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={busy || !name.trim()}>
              Fix spelling
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="px-1 text-12 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
