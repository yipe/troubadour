import { AlertCircle, Loader2, MessagesSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { jobActive } from "@/lib/campaign"
import { attempt, campaignActions } from "@/lib/campaignStore"
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
          disabled={running}
          onClick={async () => {
            const j = await attempt(() => api.buildProfile(player.id))
            if (j) campaignActions.putJob(j)
          }}
        >
          {running ? <Loader2 className="animate-spin" /> : <MessagesSquare />}
          {profile ? "Update profile" : "Profile how they talk"}
        </Button>
      </div>
      {running && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {job.state === "queued" ? "Waiting for another job…" : job.message || "Reading their transcripts…"}
        </p>
      )}
      {job?.state === "error" && (
        <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="size-3.5 shrink-0" /> {job.message || "Profile failed"}
        </p>
      )}
      {!profile && !running && (
        <p className="text-xs text-muted-foreground">
          From their lines in saved sessions: pace, pet phrases, questions, in-character share.
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
