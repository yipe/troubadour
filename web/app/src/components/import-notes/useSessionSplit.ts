import { useEffect, useState } from "react"
import { usePreviewImport, type ImportRow } from "@troubadour/api/campaign"
import type { SplitRow } from "./SplitRows.tsx"

export type Background = { chars: number; preview: string }

/**
 * The sessions a paste splits into by its headings, asked for once typing pauses. `rows` is empty when it
 * doesn't clearly split. `request` is what the import sends for the rows still ticked.
 */
export function useSessionSplit(text: string) {
  const { mutate: findSessions } = usePreviewImport()
  const [rows, setRows] = useState<SplitRow[]>([])
  const [more, setMore] = useState(0) // sessions found beyond what one import takes
  // What comes before the first session heading (a cast list): read as background notes unless unticked.
  const [background, setBackground] = useState<Background | null>(null)
  const [readBackground, setReadBackground] = useState(true)

  useEffect(() => {
    if (!text.trim()) {
      setRows([])
      setMore(0)
      setBackground(null)
      return
    }
    const timer = setTimeout(
      () =>
        findSessions(
          { title: "", text },
          {
            onSuccess: (found) => {
              setMore(found.more)
              setBackground(
                found.background ? { chars: found.background_chars, preview: found.background } : null,
              )
              setRows(
                found.sessions.map((s, index) => ({
                  index,
                  n: s.n,
                  include: true,
                  date: s.date ?? "",
                  past: s.date === null, // no date in the heading: unknown, before every dated session
                  title: s.title ?? "",
                  preview: s.preview,
                })),
              )
            },
          },
        ),
      400,
    )
    return () => clearTimeout(timer)
  }, [text, findSessions])

  const chosen = rows.filter((r) => r.include && (r.past || r.date))
  const sessions: ImportRow[] = chosen.map((r) => ({
    index: r.index,
    date: r.past ? null : r.date,
    title: r.title.trim() || null,
  }))
  return {
    rows,
    setRows,
    more,
    background,
    readBackground,
    setReadBackground,
    /** How many sessions the import will add. */
    count: sessions.length,
    /** The `sessions` and `background` of an import, or {} when nothing is ticked. */
    request: request(sessions, background !== null && readBackground),
  }
}

function request(
  sessions: ImportRow[],
  background: boolean,
): { sessions?: ImportRow[]; background?: boolean } {
  if (sessions.length === 0) return {}
  return background ? { sessions, background } : { sessions }
}

export type SessionSplit = ReturnType<typeof useSessionSplit>
