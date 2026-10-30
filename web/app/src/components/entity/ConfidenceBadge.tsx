import { Badge } from "@troubadour/ui/badge"
import { CONFIDENCE, type Confidence } from "../../lib/confidence.ts"

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const { label, tone } = CONFIDENCE[confidence]
  return <Badge tone={tone}>{label}</Badge>
}
