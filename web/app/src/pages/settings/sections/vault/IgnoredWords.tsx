import { useState } from "react"
import { RotateCcw } from "lucide-react"
import { useCampaign, useUnignoreWord } from "@troubadour/api/campaign"
import { SearchInput } from "@troubadour/ui/search-input"

const SEARCH_ABOVE = 20

/** Words Troubadour was told to stop suggesting as names (kept in the vault as "Ignored words.md"). */
export function IgnoredWords() {
  const words = useCampaign().data?.ignored ?? []
  const unignore = useUnignoreWord()
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = (q ? words.filter((w) => w.toLowerCase().includes(q)) : words)
    .slice()
    .sort((a, b) => a.localeCompare(b, "en-US", { sensitivity: "base" }))

  return (
    <section aria-label="Ignored words" className="flex flex-col gap-3">
      <h2 className="font-serif text-20 font-bold">Ignored words</h2>
      <p className="text-13 text-ink-muted">
        Words you told Troubadour are not names, so it stops suggesting them. Unignore one to hear about it
        again.
      </p>
      {words.length === 0 ? (
        <p className="text-13 text-ink-subtle">Nothing is ignored.</p>
      ) : (
        <>
          {words.length > SEARCH_ABOVE && (
            <SearchInput
              aria-label="Search ignored words"
              placeholder="Search ignored words"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              className="max-w-xs"
            />
          )}
          <ul className="flex flex-wrap gap-2">
            {shown.map((w) => (
              <li
                key={w}
                className="flex items-center gap-1.5 rounded-control border border-line bg-surface py-1 pr-1.5 pl-2.5 text-13"
              >
                {w}
                <button
                  type="button"
                  aria-label={`Unignore ${w}`}
                  title="Unignore"
                  onClick={() => unignore.mutate(w)}
                  className="flex cursor-pointer text-ink-subtle hover:text-ink"
                >
                  <RotateCcw size={13} />
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="text-13 text-ink-subtle">No ignored word matches.</p>}
        </>
      )}
    </section>
  )
}
