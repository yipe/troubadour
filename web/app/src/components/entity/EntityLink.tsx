import type { ReactNode } from "react"
import { Link } from "react-router"
import { useCampaign, type EntityType } from "@troubadour/api/campaign"
import { findEntity } from "../../lib/entities.ts"
import { paths } from "../../paths.ts"

export type EntityLinkProps = {
  name: string
  /** Skips the lookup of the type; items are tinted by it. */
  type?: EntityType
  /** What to show instead of the name (the `[[Target|label]]` form). */
  children?: ReactNode
}

/** A link to the codex entry; a name the campaign doesn't know (or hasn't loaded yet) is plain text. */
export function EntityLink({ name, type, children }: EntityLinkProps) {
  const entities = useCampaign().data?.entities
  const entity = entities ? findEntity(entities, name) : undefined
  const label = children ?? name
  if (!entity) return <span>{label}</span>
  const tone = (type ?? entity.type) === "item" ? "text-legendary" : "text-accent"
  return (
    <Link to={paths.codex(entity.name)} className={`font-medium hover:underline ${tone}`}>
      {label}
    </Link>
  )
}
