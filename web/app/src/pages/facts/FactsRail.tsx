import { Plus } from "lucide-react"
import type { Player } from "@troubadour/api/players"
import { useClasses } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { NavItem } from "@troubadour/ui/nav-item"
import { SearchInput } from "@troubadour/ui/search-input"
import { RailGroup } from "@troubadour/ui/rail-group"
import { playerColor } from "../../lib/players.ts"
import { ABOUT_FILTERS, SURE_FILTERS, type Facet, type Filters } from "./data.ts"

export type FactsRailProps = {
  filters: Filters
  counts: Record<Facet, Map<string | undefined, number>>
  players: Player[]
  onChange: (patch: Partial<Record<keyof Filters, string | undefined>>) => void
  onAdd: () => void
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <RailGroup label={label} count={count} className="px-2 pb-3">
      {children}
    </RailGroup>
  )
}

function playerLabel(p: Player): string {
  if (p.is_gm) return `${p.name} · GM and NPCs`
  return p.character ? `${p.character} · ${p.name}` : p.name
}

export function FactsRail({ filters, counts, players, onChange, onAdd }: FactsRailProps) {
  const classes = useClasses().data ?? []
  return (
    <div className="flex flex-col">
      <div className="flex gap-2 border-b border-line p-4">
        <SearchInput
          aria-label="Search facts"
          placeholder="Search facts, names, quotes…"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          onClear={() => onChange({ q: undefined })}
        />
        <Button variant="primary" size="lg" className="shrink-0" onClick={onAdd}>
          <Plus className="size-3.5" />
          Add fact
        </Button>
      </div>
      <nav aria-label="Fact filters" className="pt-2">
        <Group label="About" count={ABOUT_FILTERS.length + 1}>
          <NavItem
            selected={!filters.about}
            count={counts.about.get(undefined) ?? 0}
            onClick={() => onChange({ about: undefined })}
          >
            Everything
          </NavItem>
          {ABOUT_FILTERS.map((f) => (
            <NavItem
              key={f.id}
              selected={filters.about === f.id}
              count={counts.about.get(f.id) ?? 0}
              onClick={() => onChange({ about: f.id })}
            >
              {f.label}
            </NavItem>
          ))}
        </Group>
        <Group label="How sure" count={SURE_FILTERS.length}>
          {SURE_FILTERS.map((f) => (
            <NavItem
              key={f.id}
              selected={filters.sure === f.id}
              dot={f.dot}
              count={counts.sure.get(f.id) ?? 0}
              onClick={() => onChange({ sure: filters.sure === f.id ? undefined : f.id })}
            >
              {f.label}
            </NavItem>
          ))}
        </Group>
        <Group label="Said by" count={players.length}>
          {players.map((p) => (
            <NavItem
              key={p.id}
              selected={filters.by === p.id}
              icon={
                <span className="size-[7px] rounded-full" style={{ background: playerColor(p, classes) }} />
              }
              count={counts.by.get(p.id) ?? 0}
              onClick={() => onChange({ by: filters.by === p.id ? undefined : p.id })}
            >
              {playerLabel(p)}
            </NavItem>
          ))}
        </Group>
      </nav>
    </div>
  )
}
