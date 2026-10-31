import { useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useCampaign } from "@troubadour/api/campaign"
import { useLive } from "@troubadour/api/live"
import { useSessions } from "@troubadour/api/sessions"
import { PageHeading } from "@troubadour/ui/page-heading"
import { RailLayout } from "@troubadour/ui/rail-layout"
import { Spinner } from "@troubadour/ui/spinner"
import { FactsTable } from "../../components/facts-table/FactsTable.tsx"
import { sessionNumbers } from "../../lib/sessions.ts"
import { AddFactDialog } from "./AddFactDialog.tsx"
import { allRows, facetCounts, matches, newestFirst, parseFilters, type Filters } from "./data.ts"
import { FactsRail } from "./FactsRail.tsx"

export function Component() {
  const campaign = useCampaign().data
  const sessions = useSessions().data
  const players = useLive((s) => s.players)
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const filters = useMemo(() => parseFilters(params), [params])

  const rows = useMemo(() => allRows(campaign), [campaign])
  const numbers = useMemo(() => sessionNumbers(sessions ?? []), [sessions])
  const shown = useMemo(
    () =>
      newestFirst(
        rows.filter((r) => matches(r, filters)),
        numbers,
      ),
    [rows, filters, numbers],
  )
  const counts = useMemo(
    () => ({
      about: facetCounts(rows, filters, "about"),
      sure: facetCounts(rows, filters, "sure"),
      by: facetCounts(rows, filters, "by"),
    }),
    [rows, filters],
  )

  if (!campaign) return <Spinner />

  // Filters live in the query string so a reload or a shared link keeps them; typing replaces
  // the entry rather than adding one per keystroke.
  const change = (patch: Partial<Record<keyof Filters, string | undefined>>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )

  return (
    <RailLayout
      railWidth={380}
      railToggleLabel="filters"
      rail={
        <FactsRail
          filters={filters}
          counts={counts}
          players={players}
          onChange={change}
          onAdd={() => setAdding(true)}
        />
      }
    >
      <div className="flex flex-col gap-4 px-5 py-5 md:px-10">
        <PageHeading
          className="flex-wrap [&>div:first-child]:min-w-[14rem]"
          title="Facts"
          subtitle={`${rows.length} things that stay true between sessions. Every one links to the moment it was said.`}
          actions={<span className="text-12 text-ink-subtle">Sort: newest session first</span>}
        />
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <FactsTable rows={shown} emptyText="No facts match these filters." />
        </div>
      </div>
      <AddFactDialog open={adding} onOpenChange={setAdding} entities={campaign.entities} />
    </RailLayout>
  )
}
