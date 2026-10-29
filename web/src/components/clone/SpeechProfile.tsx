import { Loader2, MessagesSquare } from "lucide-react"
import { JobStatus } from "@/components/campaign/JobProgress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { jobActive } from "@/lib/campaign"
import { campaignActions } from "@/lib/campaignStore"
import type { CampaignJob, Player, SpeechProfile as Profile } from "@/lib/types"

const pct = (share: number) => `${Math.round(share * 100)}%`

/** Voice clone dialog: how they talk, counted from their saved transcripts plus the AI's description. */
export function SpeechProfile({
  player,
  profile,
  job,
}: {
  player: Player
  profile: Profile | undefined
  job: CampaignJob | undefined
}) {
  const running = !!job && jobActive(job)
  const stats = profile && [
    profile.wpm != null && `${profile.wpm} words a minute`,
    `${profile.words_per_line} words a line`,
    `${pct(profile.questions)} questions`,
    `${pct(profile.exclamations)} exclamations`,
    `${pct(profile.in_character)} in character`,
  ]

  return (
    <section aria-label="How they talk" className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">How {player.name} talks</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={running || !player.clone_ok}
          title={
            player.clone_ok ? undefined : "Turn on the switch above first: the profile needs their consent"
          }
          onClick={() => void campaignActions.startJob(() => api.buildProfile(player.id))}
        >
          {running ? <Loader2 className="animate-spin" /> : <MessagesSquare />}
          {profile ? "Update profile" : "Profile how they talk"}
        </Button>
      </div>
      <JobStatus job={job} working="Reading their transcripts…" failed="Profile failed" />
      {!profile && !running && (
        <p className="text-xs text-muted-foreground">
          {player.clone_ok
            ? "From their lines in saved sessions: pace, pet phrases, questions, in-character share."
            : `Needs ${player.name}'s consent: turn on the switch above.`}
        </p>
      )}
      {profile && (
        <div className="space-y-2 text-sm">
          {profile.description && <p>{profile.description}</p>}
          <p className="text-xs text-muted-foreground tabular-nums">{stats?.filter(Boolean).join(" · ")}</p>
          {profile.phrases.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">Says a lot:</span>
              {profile.phrases.map((p) => (
                <Badge key={p} variant="secondary">
                  “{p}”
                </Badge>
              ))}
            </div>
          )}
          {profile.openers.length > 0 && (
            <p className="text-xs text-muted-foreground">Often starts with: {profile.openers.join(", ")}</p>
          )}
          <p className="text-xs text-muted-foreground">
            From {profile.lines} lines in {profile.sessions} session{profile.sessions === 1 ? "" : "s"}.
          </p>
        </div>
      )}
    </section>
  )
}
