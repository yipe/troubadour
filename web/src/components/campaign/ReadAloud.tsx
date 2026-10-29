import { useEffect, useState } from "react"
import { AlertCircle, Loader2, Speech } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { api } from "@/lib/api"
import { jobActive, jobCount } from "@/lib/campaign"
import { attempt, campaignActions, useCampaign } from "@/lib/campaignStore"
import { refreshClones, useClones } from "@/lib/cloneStore"
import { useStore } from "@/lib/store"

/** History viewer, under a written-up session: its page read aloud in a player's cloned voice. */
export function ReadAloud({ sessionId }: { sessionId: string }) {
  const clones = useClones((s) => s.clones)
  const players = useStore((s) => s.players)
  const idle = useStore((s) => (s.session?.status ?? "idle") === "idle")
  const jobs = useCampaign((s) => s.jobs)
  const [reader, setReader] = useState("")

  useEffect(() => {
    void refreshClones()
  }, [])

  const voiced = players.filter((p) => p.clone_ok && clones?.voices[p.id])
  const pick = voiced.find((p) => p.id === reader) ?? voiced[0]
  const job = Object.values(jobs)
    .filter((j) => j.kind === "read" && j.title === sessionId)
    .at(-1)
  const running = !!job && jobActive(job)
  const clip = clones?.clips.find((c) => c.kind === "read" && c.source.session === sessionId)

  if (!clones) return null
  if (!voiced.length && !clip)
    return (
      <p className="text-xs text-muted-foreground">
        Build a player&apos;s voice clone in Setup to hear this read aloud.
      </p>
    )

  return (
    <div className="flex w-full flex-col items-start gap-2">
      {voiced.length > 0 && (
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="Read by"
            value={pick?.id ?? ""}
            onChange={(e) => setReader(e.target.value)}
          >
            {voiced.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            variant="outline"
            disabled={running || !idle || !pick}
            title={idle ? undefined : "Stop the session first"}
            onClick={async () => {
              const j = pick && (await attempt(() => api.cloneRead(pick.id, sessionId)))
              if (j) campaignActions.putJob(j)
            }}
          >
            {running ? <Loader2 className="animate-spin" /> : <Speech />}
            Read aloud
            {running && <span className="text-muted-foreground tabular-nums">{jobCount(job)}</span>}
          </Button>
        </div>
      )}
      {job?.state === "error" && (
        <span role="alert" className="inline-flex items-center gap-1 text-destructive">
          <AlertCircle className="size-3.5" /> {job.message || "Reading failed"}
        </span>
      )}
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
