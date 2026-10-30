import { useState } from "react"
import { Search } from "lucide-react"
import { useEntity, useSeekFacts, type Entity } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Chip } from "@troubadour/ui/chip"
import { SectionLabel } from "@troubadour/ui/section-label"
import { FactText } from "../../components/entity/FactText.tsx"
import { TypeBadge } from "../../components/entity/TypeBadge.tsx"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { useJob } from "../../components/jobs/useJob.ts"
import { AppearancesChart } from "./AppearancesChart.tsx"
import { useHeardAsActions, useSuggestedEntryActions } from "./edit/actions.ts"
import { EditEntryDialog } from "./edit/EditEntryDialog.tsx"
import { FactsCard } from "./FactsCard.tsx"

export function EntryPage({ name }: { name: string }) {
  const entity = useEntity(name).data
  return entity ? <Entry entity={entity} /> : null
}

function Entry({ entity }: { entity: Entity }) {
  const [editing, setEditing] = useState(false)
  const seek = useSeekFacts()
  const { job } = useJob("facts", entity.name)
  const heard = useHeardAsActions(entity)
  const suggested = useSuggestedEntryActions(entity)

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5 p-6">
      {entity.status === "suggested" ? (
        <div className="flex items-center gap-3 rounded-card border border-line bg-warning-faint px-4 py-2.5 text-14">
          <span className="flex-1">Suggested from a session. Keep it?</span>
          <Button size="sm" variant="primary" onClick={suggested.keep}>
            Keep
          </Button>
          <Button size="sm" variant="danger" onClick={suggested.remove}>
            Delete
          </Button>
        </div>
      ) : null}
      <header className="flex items-start gap-3">
        <h1 className="font-serif text-32 leading-tight font-bold text-ink">{entity.name}</h1>
        <span className="mt-2">
          <TypeBadge type={entity.type} />
        </span>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button onClick={() => seek.mutate(entity.name)} disabled={seek.isPending}>
            <Search aria-hidden className="size-3.5" />
            Look for more facts
          </Button>
          <Button onClick={() => setEditing(true)}>Edit</Button>
        </div>
      </header>
      {job ? <JobStatus job={job} variant="inline" /> : null}
      {entity.description ? (
        <p className="text-15 text-ink-muted">
          <FactText text={entity.description} />
        </p>
      ) : null}
      {entity.aliases.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-13">
          <SectionLabel>Also called</SectionLabel>
          <span className="text-ink">{entity.aliases.join(", ")}</span>
        </p>
      ) : null}
      {entity.heard_as.length + entity.heard_as_suggested.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel>Heard as</SectionLabel>
          {entity.heard_as.map((h) => (
            <Chip key={h}>{h}</Chip>
          ))}
          {entity.heard_as_suggested.map((h) => (
            <Chip key={h} dashed onAccept={() => heard.accept(h)} onReject={() => heard.reject(h)}>
              {h}
            </Chip>
          ))}
        </div>
      ) : null}
      <AppearancesChart appearances={entity.appearances} />
      <FactsCard entity={entity} />
      <EditEntryDialog entity={entity} open={editing} onOpenChange={setEditing} />
    </div>
  )
}
