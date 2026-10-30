import type { Campaign, Entity } from "@troubadour/api/campaign"
import { SectionLabel } from "@troubadour/ui/section-label"
import { EntityLink } from "../../components/entity/EntityLink.tsx"
import { connectedEntries, findEntity, obsidianUrl } from "../../lib/entities.ts"

export function ConnectedRail({ entity, campaign }: { entity: Entity; campaign: Campaign }) {
  const connected = connectedEntries(entity, campaign)
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <SectionLabel>Connected</SectionLabel>
      {connected.length === 0 ? (
        <p className="text-13 text-ink-subtle">Nothing links here yet.</p>
      ) : (
        <ul className="flex flex-col">
          {connected.map((c) => (
            <li key={c.name} className="border-b border-line py-2.5 first:pt-0">
              <div className="text-14 font-medium">
                <EntityLink name={c.name} type={findEntity(campaign.entities, c.name)?.type} />
              </div>
              <div className="text-12 text-ink-subtle">{c.reason}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-col gap-1 text-12">
        {entity.path ? <span className="font-mono break-all text-ink-subtle">{entity.path}</span> : null}
        {campaign.obsidian ? (
          <a className="w-fit text-accent hover:underline" href={obsidianUrl(campaign.obsidian, entity.path)}>
            Open in Obsidian
          </a>
        ) : (
          <p className="text-ink-subtle">
            Obsidian doesn’t know this vault yet, so the note can’t be opened from here. Open the vault in
            Obsidian once and it will work.
          </p>
        )}
      </div>
    </div>
  )
}
