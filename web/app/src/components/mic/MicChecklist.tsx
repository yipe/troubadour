import { AlertTriangle, Check, Minus } from "lucide-react"
import type { ChecklistRow, Tone } from "./checklistRows.ts"

const ICON = { ok: Check, warn: AlertTriangle, none: Minus } as const
const ICON_CLASS: Record<Tone, string> = { ok: "text-success", warn: "text-warning", none: "text-ink-subtle" }
const ICON_LABEL: Record<Tone, string> = { ok: "OK", warn: "Needs attention", none: "Not checked" }

export function MicChecklist({ rows }: { rows: ChecklistRow[] }) {
  if (rows.length === 0) return null
  return (
    <ul aria-label="Mic checks" className="flex flex-col gap-1.5 text-13">
      {rows.map((r) => {
        const Icon = ICON[r.tone]
        return (
          <li key={r.id} data-check={r.id} data-tone={r.tone} className="flex items-center gap-2">
            <Icon aria-label={ICON_LABEL[r.tone]} className={`size-3.5 shrink-0 ${ICON_CLASS[r.tone]}`} />
            <span className="flex-1">{r.label}</span>
            {r.value && <span className="text-ink-subtle">{r.value}</span>}
          </li>
        )
      })}
    </ul>
  )
}
