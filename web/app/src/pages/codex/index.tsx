import { Navigate, useParams } from "react-router"
import { useCampaign } from "@troubadour/api/campaign"
import { PageHeading } from "@troubadour/ui/page-heading"
import { RailLayout } from "@troubadour/ui/rail-layout"
import { paths } from "../../paths.ts"
import { ConnectedRail } from "./ConnectedRail.tsx"
import { EntryPage } from "./EntryPage.tsx"
import { EntryRail } from "./EntryRail.tsx"

export function Component() {
  const { entry } = useParams()
  const campaign = useCampaign().data
  if (!campaign)
    return (
      <div className="p-8">
        <PageHeading title="Codex" />
      </div>
    )
  const entities = campaign.entities
  const selected = entities.find((e) => e.name === entry)
  // `/codex` (or a name that is gone) opens the first entry.
  if (!selected && entities[0]) return <Navigate to={paths.codex(entities[0].name)} replace />
  return (
    <RailLayout
      rail={<EntryRail entities={entities} selected={selected?.name} />}
      railWidth={320}
      asideWidth={300}
      aside={selected ? <ConnectedRail entity={selected} campaign={campaign} /> : undefined}
    >
      {selected ? (
        <EntryPage name={selected.name} />
      ) : (
        <div className="p-8">
          <PageHeading
            title="Codex"
            subtitle="The codex is empty. Entries appear as sessions are written up."
          />
        </div>
      )}
    </RailLayout>
  )
}
