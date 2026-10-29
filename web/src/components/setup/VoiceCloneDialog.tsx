import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Loader2, Speech, Trash2, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { jobActive, jobCount } from "@/lib/campaign"
import { attempt, campaignActions, useCampaign } from "@/lib/campaignStore"
import { refreshClones, useClones } from "@/lib/cloneStore"
import { actions, useStore } from "@/lib/store"
import type { CampaignJob, Player } from "@/lib/types"
import { SpeechProfile } from "./SpeechProfile"

const SAY_MAX = 2000

function JobLine({ job, fallback }: { job: CampaignJob | undefined; fallback: string }) {
  if (!job) return null
  if (jobActive(job))
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {job.state === "queued" ? "Waiting for another job…" : job.message || fallback} {jobCount(job)}
      </p>
    )
  if (job.state === "error")
    return (
      <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
        <AlertCircle className="size-3.5" /> {job.message || "Failed"}
      </p>
    )
  return null
}

/** Setup: a player's voice clone. Their consent, building it from the Train recording, a preview,
 * and typed lines spoken in their voice. Nothing plays until clicked. */
export function VoiceCloneDialog({
  player,
  trained,
  open,
  onOpenChange,
}: {
  player: Player
  trained: boolean
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const clones = useClones((s) => s.clones)
  const jobs = useCampaign((s) => s.jobs)
  const idle = useStore((s) => (s.session?.status ?? "idle") === "idle")
  const [text, setText] = useState("")
  const [theirWords, setTheirWords] = useState(false)

  useEffect(() => {
    if (open) void refreshClones()
  }, [open])

  const mine = Object.values(jobs).filter((j) => j.player_id === player.id)
  const building = mine.filter((j) => j.kind === "clone").at(-1)
  const saying = mine.filter((j) => j.kind === "say").at(-1)
  const profiling = mine.filter((j) => j.kind === "profile").at(-1)
  const busy = [building, saying].some((j) => j && jobActive(j))
  const voice = clones?.voices[player.id]
  const profile = clones?.profiles[player.id]
  const clips = useMemo(
    () => (clones?.clips ?? []).filter((c) => c.player_id === player.id && c.kind === "say"),
    [clones, player.id],
  )

  const setConsent = async (on: boolean) => {
    const made = !!voice || !!profile || clips.length > 0
    const question = `Delete ${player.name}'s voice clone, speech profile and every clip made with them?`
    if (!on && made && !window.confirm(question)) return
    const p = await attempt(() => api.updatePlayer(player.id, { clone_ok: on }))
    if (!p) return
    actions.upsertPlayer(p)
    if (!on) void refreshClones()
  }

  const start = async (call: () => Promise<CampaignJob>) => {
    const j = await attempt(call)
    if (j) campaignActions.putJob(j)
    return !!j
  }

  const why = !idle ? "Stop the session first" : busy ? "Wait for the current job" : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{player.name}&apos;s voice clone</DialogTitle>
          <DialogDescription>
            Troubadour can speak in {player.name}&apos;s voice, copied from their Train recording. It all
            stays on this Mac.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={player.clone_ok} onCheckedChange={(on: boolean) => void setConsent(on)} />
          {player.name} agrees to a voice clone
        </label>

        <SpeechProfile player={player} profile={profile} job={profiling} />

        {player.clone_ok && (
          <div className="space-y-4">
            {!trained ? (
              <p className="text-sm text-muted-foreground">
                Train {player.name} first: the clone copies the Train recording.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!why}
                    title={why}
                    onClick={() => void start(() => api.buildClone(player.id))}
                  >
                    {building && jobActive(building) ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <WandSparkles />
                    )}
                    {voice ? "Rebuild voice" : "Build voice"}
                  </Button>
                  {voice?.likeness != null && (
                    <span
                      className="text-xs text-muted-foreground tabular-nums"
                      title={[
                        "How close the preview sounds to their voice at the table, to the speaker recognition (1 = the same). A clean clone of a noisy room scores a bit lower than the room itself would.",
                        ...(voice.tried ?? []).map(
                          (t) => `${t.source}: ${t.likeness == null ? "?" : t.likeness.toFixed(2)}`,
                        ),
                      ].join("\n")}
                    >
                      Likeness {voice.likeness.toFixed(2)}
                      {voice.source && ` · from the ${voice.source}`}
                      {(voice.tried?.length ?? 0) > 1 && `, best of ${voice.tried?.length}`}
                    </span>
                  )}
                </div>
                <JobLine job={building} fallback="Building…" />
                {voice && (
                  <audio
                    key={voice.preview_url}
                    aria-label="Preview"
                    controls
                    preload="none"
                    src={voice.preview_url}
                    className="h-8 w-full"
                  />
                )}
                {voice?.preview_text && voice.preview_kind && (
                  <p className="text-xs text-muted-foreground">
                    {voice.preview_kind === "ai" ? "Written in their style: " : "From their own lines: "}
                    <span className="italic">“{voice.preview_text}”</span>
                  </p>
                )}
              </div>
            )}

            {voice && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void start(() => api.cloneSay(player.id, text.trim(), theirWords && !!profile)).then(
                    (ok) => ok && setText(""),
                  )
                }}
              >
                <Textarea
                  aria-label={`Something for ${player.name} to say`}
                  placeholder={`Something for ${player.name} to say`}
                  value={text}
                  maxLength={SAY_MAX}
                  rows={3}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" type="submit" disabled={!text.trim() || !!why} title={why}>
                    {saying && jobActive(saying) ? <Loader2 className="animate-spin" /> : <Speech />} Speak
                  </Button>
                  <label
                    className="flex items-center gap-2 text-sm"
                    title={
                      profile ? "Reworded like them by the AI, at their pace" : "Profile how they talk first"
                    }
                  >
                    <Switch
                      size="sm"
                      checked={theirWords && !!profile}
                      disabled={!profile}
                      onCheckedChange={(on: boolean) => setTheirWords(on)}
                    />
                    In their words
                  </label>
                  <JobLine job={saying} fallback="Speaking…" />
                </div>
              </form>
            )}

            {clips.length > 0 && (
              <ul className="max-h-60 space-y-2 overflow-y-auto">
                {clips.map((c) => (
                  <li key={c.id} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate" title={c.text}>
                        {c.title}
                      </span>
                      {c.in_their_words && (
                        <span className="text-xs text-muted-foreground">in their words</span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(c.seconds)}s
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete "${c.title}"`}
                        onClick={async () => {
                          await attempt(() => api.deleteClip(player.id, c.id))
                          void refreshClones()
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <audio controls preload="none" src={c.url} className="h-8 w-full" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
