import { Link } from "react-router"
import { Mic, MessageCircleQuestion } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useCampaigns } from "@troubadour/api/campaigns"
import { useLive } from "@troubadour/api/live"
import { useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { PageHeading } from "@troubadour/ui/page-heading"
import { obsidianUrl } from "../../lib/entities.ts"
import { duration } from "../../lib/format.ts"
import { nextSessionNumber, sessionNumbers } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { homeStats } from "./data.ts"
import { LastSession } from "./LastSession.tsx"
import { NewestFacts } from "./NewestFacts.tsx"
import { TheTable } from "./TheTable.tsx"

export function Component() {
  const campaign = useCampaign().data
  const campaigns = useCampaigns().data
  const sessions = useSessions().data ?? []
  const players = useLive((s) => s.players)
  const voices = useLive((s) => s.voices)
  const running = useLive((s) => (s.session?.status ?? "idle") !== "idle")

  const numbers = sessionNumbers(sessions)
  const last = sessions
    .filter((s) => numbers.has(s.id))
    .sort((a, b) => numbers.get(b.id)! - numbers.get(a.id)!)[0]
  const stats = homeStats(campaign, sessions, numbers.size)
  const name = campaigns?.campaigns.find((c) => c.id === campaigns.campaign)?.name

  return (
    <div className="flex flex-col gap-5 px-10 py-7">
      <PageHeading
        title={name ?? "Home"}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3.5 text-13 text-ink-subtle">
            <span>
              {stats.sessions} {stats.sessions === 1 ? "session" : "sessions"}
            </span>
            <span>·</span>
            <span>{duration(stats.recordedS)} recorded</span>
            <span>·</span>
            <span>
              {stats.entries} entries, {stats.facts} facts
            </span>
            {campaign ? (
              <>
                <span>·</span>
                <a
                  href={campaign.obsidian ? obsidianUrl(campaign.obsidian) : undefined}
                  className="font-mono text-12 text-accent hover:underline"
                >
                  {campaign.vault}
                </a>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button size="lg" nativeButton={false} render={<Link to={paths.ask()} />}>
              <MessageCircleQuestion className="size-4" />
              Ask the campaign
            </Button>
            <Button
              variant="primary"
              size="lg"
              nativeButton={false}
              render={<Link to={running ? paths.live() : paths.ready()} />}
            >
              <Mic className="size-4" />
              {running ? "Back to the session" : `Prepare session ${nextSessionNumber(sessions)}`}
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] gap-[18px]">
        <section className="flex flex-col gap-[18px]">
          <LastSession
            session={last}
            n={last ? numbers.get(last.id)! : 1}
            writtenUp={!!last && last.id in (campaign?.written_up ?? {})}
            players={players}
          />
        </section>
        <TheTable players={players} voices={voices} />
        <NewestFacts campaign={campaign} sessions={sessions} numbers={numbers} players={players} />
      </div>
    </div>
  )
}
