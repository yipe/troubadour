import { useRef, useState, type ChangeEvent } from "react"
import { Trash2, Upload } from "lucide-react"
import {
  useAddTerms,
  useRemoveTerm,
  useTerms,
  useUploadTerms,
  type TermSource,
  type TermsAdded,
} from "@troubadour/api/terms"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { Input } from "@troubadour/ui/input"
import { NativeSelect } from "@troubadour/ui/native-select"
import { SearchInput } from "@troubadour/ui/search-input"
import { notify } from "@troubadour/ui/toast"
import { SrdAttribution } from "./SrdAttribution.tsx"

const PAGE = 50
const MAX_NAME = 60

/** The glossary's types, in the order the add form offers them. */
const TYPES = [
  ["creature", "Creature"],
  ["spell", "Spell"],
  ["item", "Item"],
  ["place", "Place"],
  ["faction", "Faction"],
  ["npc", "Character"],
  ["term", "Other term"],
] as const

const SOURCES: { id: TermSource | ""; label: string }[] = [
  { id: "", label: "All" },
  { id: "builtin", label: "SRD (built-in)" },
  { id: "local", label: "Your local list" },
  { id: "custom", label: "Added by you" },
]

const typeLabel = (type: string) => TYPES.find(([id]) => id === type)?.[1] ?? type

/** The D&D names the spelling cleanup corrects toward: browse them, add your own, upload a list. */
export function TermsSection() {
  const [q, setQ] = useState("")
  const [source, setSource] = useState<TermSource | "">("")
  const [limit, setLimit] = useState(PAGE)
  const terms = useTerms({ q: q.trim(), source: source || null, offset: 0, limit })
  const add = useAddTerms()
  const remove = useRemoveTerm()
  const upload = useUploadTerms()
  const [name, setName] = useState("")
  const [type, setType] = useState<string>("creature")
  const [result, setResult] = useState<{ label: string; outcome: TermsAdded } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const counts = terms.data?.counts
  const items = terms.data?.items ?? []
  const total = terms.data?.total ?? 0

  const report = (label: string) => ({
    onSuccess: (outcome: TermsAdded) => setResult({ label, outcome }),
    onError: (e: Error) => notify(e.message, { tone: "danger" }),
  })

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || add.isPending) return
    add.mutate([{ name: trimmed, type }], {
      ...report(trimmed),
      onSuccess: (outcome) => {
        report(trimmed).onSuccess(outcome)
        if (outcome.added) setName("")
      },
    })
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // choosing the same file again should still fire
    if (!file) return
    upload.mutate(await file.text(), report(file.name))
  }

  return (
    <section aria-label="D&D terms" className="flex flex-col gap-3">
      <h2 className="font-serif text-20 font-bold">D&amp;D terms</h2>
      <p className="text-13 text-ink-muted">
        Names speech-to-text tends to mangle. The spelling cleanup corrects toward these, and never rewrites
        an everyday word.
      </p>
      {counts && (
        <p className="text-13 text-ink-subtle">
          {counts.builtin} SRD
          {counts.local > 0 && <> · {counts.local} in your local list</>} · {counts.custom} added by you
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <SearchInput
          aria-label="Search terms"
          placeholder="Search terms"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setLimit(PAGE)
          }}
          onClear={() => setQ("")}
          className="max-w-xs"
        />
        <div className="w-48">
          <NativeSelect
            aria-label="Show terms from"
            value={source}
            onChange={(e) => {
              setSource(e.target.value as TermSource | "")
              setLimit(PAGE)
            }}
          >
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <ul aria-label="Terms" className="overflow-hidden rounded-card border border-line">
        {items.map((t) => (
          <li
            key={t.name}
            className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-14 last:border-b-0"
          >
            <span className="flex-1 font-semibold">{t.name}</span>
            <Badge>{typeLabel(t.type)}</Badge>
            {t.source === "custom" ? (
              <Button
                variant="ghost"
                aria-label={`Remove ${t.name}`}
                onClick={() =>
                  remove.mutate(t.name, { onError: (e) => notify(e.message, { tone: "danger" }) })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : (
              <span className="w-[42px]" />
            )}
          </li>
        ))}
        {terms.data && items.length === 0 && (
          <li className="bg-surface px-4 py-3 text-13 text-ink-subtle">No term matches.</li>
        )}
      </ul>
      {total > items.length && (
        <Button className="self-start" onClick={() => setLimit(limit + PAGE)}>
          Show more ({total - items.length} left)
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64">
          <Input
            aria-label="Term name"
            placeholder="A name speech-to-text gets wrong"
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <div className="w-40">
          <NativeSelect aria-label="Term type" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="primary" disabled={!name.trim() || add.isPending} onClick={submit}>
          Add term
        </Button>
        <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
          <Upload className="size-3.5" /> Upload a list…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.csv,.json,text/plain,text/csv,application/json"
          aria-label="Term list file"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
      </div>
      <p className="text-12 text-ink-subtle">
        A list is one term per line, optionally <code>name,type</code>, or JSON. Up to 1 MB.
      </p>
      <SrdAttribution />

      {result && (
        <div role="status" className="rounded-card border border-line bg-surface px-4 py-3 text-13">
          <p className="font-semibold">
            {result.outcome.added === 0
              ? `Nothing was added from ${result.label}.`
              : `Added ${result.outcome.added} ${result.outcome.added === 1 ? "term" : "terms"} from ${result.label}.`}
          </p>
          {result.outcome.skipped.length > 0 && (
            <ul className="mt-1 text-ink-muted">
              {result.outcome.skipped.map((s) => (
                <li key={s.name}>
                  {s.name}: {s.reason}
                </li>
              ))}
              {result.outcome.more_skipped > 0 && <li>…and {result.outcome.more_skipped} more skipped.</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
