import type { EntityType } from "@troubadour/api/campaign"
import { Badge } from "@troubadour/ui/badge"
import { entityTone, TYPE_LABEL } from "../../lib/entities.ts"

export function TypeBadge({ type }: { type: EntityType }) {
  return <Badge tone={entityTone(type)}>{TYPE_LABEL[type]}</Badge>
}
