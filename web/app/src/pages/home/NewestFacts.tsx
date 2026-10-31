import { Link } from "react-router"
import type { Campaign } from "@troubadour/api/campaign"
import type { Player } from "@troubadour/api/players"
import { useClasses } from "@troubadour/api/players"
import type { SavedSession } from "@troubadour/api/sessions"
import { Card, CardHeader } from "@troubadour/ui/card"
import { TimestampLink } from "../../components/audio/TimestampLink.tsx"
import { ConfidenceBadge } from "../../components/entity/ConfidenceBadge.tsx"
import { FactText } from "../../components/entity/FactText.tsx"
import { playerColor } from "../../lib/players.ts"
import { paths } from "../../paths.ts"
import { newestFacts } from "./data.ts"

export type NewestFactsProps = {
  campaign: Campaign | undefined
  sessions: SavedSession[]
  numbers: ReadonlyMap<string, number>
  players: Player[]
}

export function NewestFacts({ campaign, sessions, numbers, players }: NewestFactsProps) {
  const classes = useClasses().data ?? []
  const facts = newestFacts(campaign, numbers)
  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader
        title="Newest facts"
        action={
          <Link to={paths.facts()} className="text-12 text-accent hover:underline">
            All facts →
          </Link>
        }
      />
      {facts.length === 0 ? <p className="px-4 py-3 text-13 text-ink-subtle">No facts yet.</p> : null}
      {facts.map(({ fact, sessionId, n, t }) => {
        const who = fact.said_by
        const speaker = who?.player_id ? players.find((p) => p.id === who.player_id) : undefined
        return (
          <div key={fact.id} className="flex flex-col gap-1.5 border-b border-line-subtle px-4 py-3">
            <div className="text-pretty">
              <FactText text={fact.text} />
            </div>
            <div className="flex items-center gap-2 text-12 text-ink-subtle">
              {who ? (
                <>
                  <span
                    className="size-2 rounded-full"
                    style={{ background: speaker ? playerColor(speaker, classes) : "var(--color-fg-subtle)" }}
                  />
                  {who.name}
                  <span>·</span>
                </>
              ) : null}
              <TimestampLink
                sessionId={sessionId}
                t={t}
                n={n}
                hasAudio={sessions.find((s) => s.id === sessionId)?.audio ?? false}
              />
              <span className="ml-auto">
                <ConfidenceBadge confidence={fact.confidence} />
              </span>
            </div>
          </div>
        )
      })}
    </Card>
  )
}
