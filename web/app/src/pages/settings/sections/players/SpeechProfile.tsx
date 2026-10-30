import { Loader2, MessagesSquare } from "lucide-react"
import type { CampaignJob } from "@troubadour/api/campaign"
import { useBuildProfile, type SpeechProfile as Profile } from "@troubadour/api/clones"
import type { Player } from "@troubadour/api/players"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { notify } from "@troubadour/ui/toast"
import { JobStatus } from "../../../../components/jobs/JobStatus.tsx"
import { jobActive } from "../../../../components/jobs/progress.ts"

const pct = (share: number) => `${Math.round(share * 100)}%`

/** How they talk, counted from their saved transcripts plus the AI's description. */
export function SpeechProfile({
  player,
  profile,
  job,
}: {
  player: Player
  profile: Profile | undefined
  job: CampaignJob | undefined
}) {
  const build = useBuildProfile()
  const running = !!job && jobActive(job)
  const stats = profile && [
    profile.wpm != null && `${profile.wpm} words a minute`,
    `${profile.words_per_line} words a line`,
    `${pct(profile.questions)} questions`,
    `${pct(profile.exclamations)} exclamations`,
    `${pct(profile.in_character)} in character`,
  ]

  return (
    <section aria-label="How they talk" className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-14 font-semibold">How {player.name} talks</h3>
        <Button
          disabled={running || build.isPending || !player.clone_ok}
          title={
            player.clone_ok ? undefined : "Turn on the switch above first: the profile needs their consent"
          }
          onClick={() => build.mutate(player.id, { onError: (e) => notify(e.message, { tone: "danger" }) })}
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <MessagesSquare className="size-3.5" />}
          {profile ? "Update profile" : "Profile how they talk"}
        </Button>
      </div>
      {job && <JobStatus job={job} variant="inline" />}
      {!profile && !running && (
        <p className="text-12 text-ink-subtle">
          {player.clone_ok
            ? "From their lines in saved sessions: pace, pet phrases, questions, in-character share."
            : `Needs ${player.name}'s consent: turn on the switch above.`}
        </p>
      )}
      {profile && (
        <div className="flex flex-col gap-2 text-14">
          {profile.description && <p>{profile.description}</p>}
          <p className="text-12 text-ink-muted tabular-nums">{stats?.filter(Boolean).join(" · ")}</p>
          {profile.phrases.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-12 text-ink-muted">Says a lot:</span>
              {profile.phrases.map((p) => (
                <Badge key={p}>“{p}”</Badge>
              ))}
            </div>
          )}
          {profile.openers.length > 0 && (
            <p className="text-12 text-ink-muted">Often starts with: {profile.openers.join(", ")}</p>
          )}
          <p className="text-12 text-ink-muted">
            From {profile.lines} lines in {profile.sessions} session{profile.sessions === 1 ? "" : "s"}.
          </p>
        </div>
      )}
    </section>
  )
}
