import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useTerms } from "@troubadour/api/terms"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@troubadour/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"

const SHOWN = 6

const bigrams = (word: string) => {
  const w = word.toLowerCase()
  const out = new Map<string, number>()
  for (let i = 0; i < w.length - 1; i++) out.set(w.slice(i, i + 2), (out.get(w.slice(i, i + 2)) ?? 0) + 1)
  return out
}

/** How alike two spellings are, 0 to 1 (Dice coefficient over letter pairs): "Chilmore" ~ "Chilmar". */
function similarity(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  let shared = 0
  for (const [pair, n] of x) shared += Math.min(n, y.get(pair) ?? 0)
  const total = [...x.values(), ...y.values()].reduce((sum, n) => sum + n, 0)
  return total === 0 ? 0 : (2 * shared) / total
}

export type NamePickerProps = {
  /** The word as it was heard; the D&D terms closest to it are offered before anything is typed. */
  heard: string
  /** Names of the codex entries. */
  entryNames: string[]
  value: string
  onChange: (name: string) => void
}

/** The real name of a misheard word: search the codex and the D&D terms, or type a name of your own. */
export function NamePicker({ heard, entryNames, value, onChange }: NamePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const typed = query.trim()
  const terms = useTerms({
    q: typed,
    ...(typed ? {} : { like: heard }),
    source: null,
    offset: 0,
    limit: SHOWN,
  })
  // Typing searches by substring; before that, the entries that sound most like the word come first.
  const entries = (
    typed
      ? entryNames.filter((n) => n.toLowerCase().includes(typed.toLowerCase()))
      : entryNames
          .map((n) => [n, similarity(n, heard)] as const)
          .filter(([, score]) => score >= 0.3)
          .sort((a, b) => b[1] - a[1])
          .map(([n]) => n)
  ).slice(0, SHOWN)
  const inCodex = new Set(entries.map((n) => n.toLowerCase()))
  const known = (terms.data?.items ?? []).filter((t) => !inCodex.has(t.name.toLowerCase()))
  const exact = [...entries, ...known.map((t) => t.name)].some((n) => n.toLowerCase() === typed.toLowerCase())
  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Real name"
        className="inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-control border border-line bg-sunken px-2.5 text-13 text-ink"
      >
        <span className={value ? "truncate" : "truncate text-ink-subtle"}>
          {value || "Search or type the real name"}
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-subtle" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search or type the real name" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Type the name to use.</CommandEmpty>
            {entries.length > 0 ? (
              <CommandGroup heading={typed ? "In your codex" : "In your codex that sound like it"}>
                {entries.map((name) => (
                  <CommandItem key={`e-${name}`} value={`e-${name}`} onSelect={() => pick(name)}>
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {known.length > 0 ? (
              <CommandGroup heading={typed ? "D&D terms" : "D&D terms that sound like it"}>
                {known.map((t) => (
                  <CommandItem key={`t-${t.name}`} value={`t-${t.name}`} onSelect={() => pick(t.name)}>
                    {t.name}
                    <span className="ml-auto text-11 text-ink-subtle">{t.type}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {typed && !exact ? (
              <CommandGroup>
                <CommandItem value={`new-${typed}`} onSelect={() => pick(typed)}>
                  Use “{typed}”
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
