import { Button } from "@troubadour/ui/button"
import { Checkbox } from "@troubadour/ui/checkbox"
import { SplitRows } from "./SplitRows.tsx"
import type { SessionSplit } from "./useSessionSplit.ts"

/** The sessions found in a paste, the text before them, and how many didn't fit: shown under the notes. */
export function SplitPreview({ split }: { split: SessionSplit }) {
  const { rows, setRows, more, background, readBackground, setReadBackground } = split
  return (
    <>
      {more > 0 && (
        <p className="text-13 text-warning">
          {more} more {more === 1 ? "session was" : "sessions were"} found than one import can add. Only the
          first {rows.length} are listed; paste the rest in another import.
        </p>
      )}
      {background && (
        <label className="flex items-start gap-2 text-13">
          <Checkbox
            checked={readBackground}
            onCheckedChange={(v) => setReadBackground(v === true)}
            aria-label="Read what comes before the first session"
          />
          <span className="min-w-0">
            Also read the {background.chars.toLocaleString("en-US")} characters before the first session as
            background notes
            <span className="block truncate text-12 text-ink-subtle">{background.preview}</span>
          </span>
        </label>
      )}
      {rows.length > 1 && (
        <Button
          type="button"
          variant="link"
          className="self-start text-13"
          onClick={() => setRows(rows.map((r) => ({ ...r, past: true })))}
        >
          Mark every date unknown
        </Button>
      )}
      <SplitRows rows={rows} onChange={setRows} />
    </>
  )
}
