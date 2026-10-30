import { useState } from "react"
import { Link } from "react-router"
import type { Entity, EntityType } from "@troubadour/api/campaign"
import { useAppearances } from "@troubadour/api/timeline"
import { cn } from "@troubadour/ui/cn"
import { NavItem } from "@troubadour/ui/nav-item"
import { PillGroup } from "@troubadour/ui/pill-group"
import { SearchInput } from "@troubadour/ui/search-input"
import { TypeBadge } from "../../components/entity/TypeBadge.tsx"
import { matchesSearch, needsReview, TYPE_PLURAL } from "../../lib/entities.ts"
import { paths } from "../../paths.ts"
import { MentionBits } from "./MentionBits.tsx"

const FILTER_TYPES: EntityType[] = ["npc", "place", "item", "faction", "pc"]

/** The entries the rail shows for the current search and filters. */
function filterEntities(entities: Entity[], query: string, type: string, reviewOnly: boolean): Entity[] {
  return entities.filter(
    (e) => (type === "all" || e.type === type) && (!reviewOnly || needsReview(e)) && matchesSearch(e, query),
  )
}

export function EntryRail({ entities, selected }: { entities: Entity[]; selected: string | undefined }) {
  const [query, setQuery] = useState("")
  const [type, setType] = useState("all")
  const [reviewOnly, setReviewOnly] = useState(false)
  const { data: appearances } = useAppearances()
  const reviewCount = entities.filter(needsReview).length
  const shown = filterEntities(entities, query, type, reviewOnly)
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 border-b border-line p-3">
        <SearchInput
          aria-label="Search the codex"
          placeholder="Names, aliases, heard as…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <PillGroup
            className="contents"
            value={type}
            onChange={setType}
            items={[
              { id: "all", label: "All" },
              ...FILTER_TYPES.map((t) => ({ id: t, label: TYPE_PLURAL[t] })),
            ]}
          />
          <button
            type="button"
            aria-pressed={reviewOnly}
            onClick={() => setReviewOnly(!reviewOnly)}
            className={cn(
              "rounded-full px-3 py-1 text-13 font-semibold",
              reviewOnly ? "bg-warning text-black" : "bg-warning-soft text-warning",
            )}
          >
            Needs review {reviewCount}
          </button>
        </div>
      </div>
      <nav aria-label="Codex entries" className="flex flex-col gap-0.5 p-2">
        {shown.map((e) => (
          <NavItem
            key={e.name}
            render={<Link to={paths.codex(e.name)} />}
            selected={e.name === selected}
            sub={
              <>
                {e.aliases[0] ?? (e.status === "suggested" ? "Suggested" : null)}
                <MentionBits data={appearances} name={e.name} item={e.type === "item"} />
              </>
            }
            count={
              <span className="font-sans">
                <TypeBadge type={e.type} />
              </span>
            }
            dot={needsReview(e) ? "warning" : undefined}
            className={cn(e.type === "item" && "text-legendary")}
          >
            {e.name}
          </NavItem>
        ))}
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-13 text-ink-subtle">Nothing matches.</p>
        ) : null}
      </nav>
    </div>
  )
}
