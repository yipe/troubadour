import { useEffect, useState } from "react"
import { Loader2, Speech } from "lucide-react"
import { JobStatus } from "@/components/campaign/JobProgress"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { api } from "@/lib/api"
import { jobActive, jobCount, latestJob } from "@/lib/campaign"
import { campaignActions, useCampaign } from "@/lib/campaignStore"
import { refreshClones, useClones } from "@/lib/cloneStore"
import { useIdle, useStore } from "@/lib/store"
import { TheirWordsSwitch } from "./TheirWordsSwitch"

/** History viewer, under a written-up session: its page (`page`, vault-relative) read aloud in a
 * player's cloned voice. */
export function ReadAloud({ sessionId, page }: { sessionId: string; page: string }) {
  const clones = useClones((s) => s.clones)
  const players = useStore((s) => s.players)
  const idle = useIdle()
  const job = useCampaign((s) => latestJob(s.jobs, (j) => j.kind === "read" && j.note === page))
  const [reader, setReader] = useState("")
  const [theirWords, setTheirWords] = useState(false)

  useEffect(() => {
    void refreshClones()
  }, [])

  if (!clones) return null
  const voiced = players.filter((p) => p.clone_ok && clones.voices[p.id])
  const pick = voiced.find((p) => p.id === reader) ?? voiced[0]
  const profiled = !!pick && !!clones.profiles[pick.id]
  const running = !!job && jobActive(job)
  const clip = clones.clips.find((c) => c.kind === "read" && c.source.session === sessionId)

  if (!pick && !clip)
    return (
      <p className="text-xs text-muted-foreground">
        Build a player&apos;s voice clone in Setup to hear this read aloud.
      </p>
    )

  return (
    <div className="flex w-full flex-col items-start gap-2">
      {pick && (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Read by" value={pick.id} onChange={(e) => setReader(e.target.value)}>
            {voiced.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            variant="outline"
            disabled={running || !idle}
            title={idle ? undefined : "Stop the session first"}
            onClick={() =>
              void campaignActions.startJob(() => api.cloneRead(pick.id, sessionId, theirWords && profiled))
            }
          >
            {running ? <Loader2 className="animate-spin" /> : <Speech />}
            Read aloud
            {running && <span className="text-muted-foreground tabular-nums">{jobCount(job)}</span>}
          </Button>
          <TheirWordsSwitch
            profiled={profiled}
            checked={theirWords}
            onChange={setTheirWords}
            missing="Profile how they talk first (Setup)"
          />
        </div>
      )}
      <JobStatus job={job} working="Reading…" failed="Reading failed" progress={false} />
      {clip && (
        <>
          <span className="text-xs text-muted-foreground">
            Read by {players.find((p) => p.id === clip.player_id)?.name ?? "a player"}
          </span>
          <audio
            key={clip.id}
            aria-label="Read aloud"
            controls
            preload="none"
            src={clip.url}
            className="h-8 w-full"
          />
        </>
      )}
    </div>
  )
}
