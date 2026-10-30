import { useEffect, useState } from "react"
import { Loader2, Speech, Trash2, WandSparkles } from "lucide-react"
import { JobStatus } from "@/components/campaign/JobProgress"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { jobActive, latestJob } from "@/lib/campaign"
import { attempt, campaignActions, useCampaign } from "@/lib/campaignStore"
import { refreshClones, useClones } from "@/lib/cloneStore"
import { actions, useIdle } from "@/lib/store"
import type { CampaignJob, CloneClip, CloneVoice, Player } from "@/lib/types"
import { SpeechProfile } from "./SpeechProfile"
import { TheirWordsSwitch } from "./TheirWordsSwitch"

const SAY_MAX = 2000 // tts.SAY_MAX_CHARS

const LIKENESS_HELP =
  "How close the preview sounds to their voice at the table, to the speaker recognition (1 = the same). " +
  "A clean clone of a noisy room scores a bit lower than the room itself would."

/** Setup: a player's voice clone. Their consent, their speech profile, building the voice, a preview,
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
  const idle = useIdle()

  useEffect(() => {
    if (open) void refreshClones()
  }, [open])

  const latest = (kind: CampaignJob["kind"]) =>
    latestJob(jobs, (j) => j.kind === kind && j.player_id === player.id)
  const building = latest("clone")
  const saying = latest("say")
  const voice = clones?.voices[player.id]
  const profile = clones?.profiles[player.id]
  const clips = (clones?.clips ?? []).filter((c) => c.player_id === player.id && c.kind === "say")
  const busy = [building, saying].some((j) => j && jobActive(j))
  const blocked = !idle ? "Stop the session first" : busy ? "Wait for the current job" : undefined

  const setConsent = async (on: boolean) => {
    const made = !!voice || !!profile || clips.length > 0
    const question = `Delete ${player.name}'s voice clone, speech profile and every clip made with them?`
    if (!on && made && !window.confirm(question)) return
    const p = await attempt(() => api.updatePlayer(player.id, { clone_ok: on }))
    if (!p) return
    actions.upsertPlayer(p)
    if (!on) void refreshClones()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{player.name}&apos;s voice clone</DialogTitle>
          <DialogDescription>
            Troubadour can speak in {player.name}&apos;s voice, copied from their Train recording or the
            cleanest stretch of their talk in your sessions, and in each character they voice. It all stays on
            this Mac.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={player.clone_ok} onCheckedChange={(on: boolean) => void setConsent(on)} />
          {player.name} agrees to a voice clone
        </label>

        <SpeechProfile player={player} profile={profile} job={latest("profile")} />

        {player.clone_ok && (
          <div className="space-y-4">
            {trained ? (
              <BuildVoice player={player} voice={voice} job={building} blocked={blocked} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Train {player.name} first: the clone needs their Train recording.
              </p>
            )}
            {voice && (
              <SayBox
                player={player}
                characters={voice.characters ?? []}
                profiled={!!profile}
                job={saying}
                blocked={blocked}
              />
            )}
            {clips.length > 0 && <ClipList player={player} clips={clips} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BuildVoice({
  player,
  voice,
  job,
  blocked,
}: {
  player: Player
  voice: CloneVoice | undefined
  job: CampaignJob | undefined
  blocked: string | undefined
}) {
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="outline"
        disabled={!!blocked}
        title={blocked}
        onClick={() => void campaignActions.startJob(() => api.buildClone(player.id))}
      >
        {job && jobActive(job) ? <Loader2 className="animate-spin" /> : <WandSparkles />}
        {voice ? "Rebuild voices" : "Build voice"}
      </Button>
      <JobStatus job={job} working="Building…" failed="Building the voice failed" />
      {voice && <VoicePreview voice={voice} name="Their own voice" />}
      {voice?.characters?.map((c) => (
        <VoicePreview key={c.persona} voice={c} name={`As ${c.label}`} />
      ))}
    </div>
  )
}

/** One of their voices: its likeness (the hover lists every reference tried), preview and what it says. */
function VoicePreview({ voice, name }: { voice: CloneVoice; name: string }) {
  const tried = (voice.tried ?? []).map((t) => `${t.source}: ${t.likeness?.toFixed(2) ?? "?"}`)
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground tabular-nums" title={[LIKENESS_HELP, ...tried].join("\n")}>
        <span className="font-medium text-foreground">{name}</span>
        {voice.likeness != null && ` · likeness ${voice.likeness.toFixed(2)}`}
        {voice.source && ` · from the ${voice.source}`}
        {tried.length > 1 && `, best of ${tried.length}`}
      </p>
      <audio
        key={voice.preview_url}
        aria-label={`Preview: ${name}`}
        controls
        preload="none"
        src={voice.preview_url}
        className="h-8 w-full"
      />
      {voice.preview_text && voice.preview_kind && (
        <p className="text-xs text-muted-foreground">
          {voice.preview_kind === "ai" ? "Written in their style: " : "From their own lines: "}
          <span className="italic">“{voice.preview_text}”</span>
        </p>
      )}
    </div>
  )
}

function SayBox({
  player,
  characters,
  profiled,
  job,
  blocked,
}: {
  player: Player
  characters: CloneVoice[]
  profiled: boolean
  job: CampaignJob | undefined
  blocked: string | undefined
}) {
  const [text, setText] = useState("")
  const [theirWords, setTheirWords] = useState(false)
  const [persona, setPersona] = useState("table")
  const own = persona === "table"
  const label = `Something for ${player.name} to say`
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const j = await campaignActions.startJob(() =>
          api.cloneSay(player.id, text.trim(), own && theirWords && profiled, persona),
        )
        if (j) setText("")
      }}
    >
      <Textarea
        aria-label={label}
        placeholder={label}
        value={text}
        maxLength={SAY_MAX}
        rows={3}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" disabled={!text.trim() || !!blocked} title={blocked}>
          {job && jobActive(job) ? <Loader2 className="animate-spin" /> : <Speech />} Speak
        </Button>
        {characters.length > 0 && (
          <NativeSelect aria-label="Voice" value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="table">Their own voice</option>
            {characters.map((c) => (
              <option key={c.persona} value={c.persona}>
                As {c.label}
              </option>
            ))}
          </NativeSelect>
        )}
        <TheirWordsSwitch
          profiled={profiled && own}
          checked={theirWords}
          onChange={setTheirWords}
          missing={own ? "Profile how they talk first" : "For their own voice"}
        />
        <JobStatus job={job} working="Speaking…" failed="Speaking failed" />
      </div>
    </form>
  )
}

function ClipList({ player, clips }: { player: Player; clips: CloneClip[] }) {
  return (
    <ul className="max-h-60 space-y-2 overflow-y-auto">
      {clips.map((c) => (
        <li key={c.id} className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate" title={c.text}>
              {c.title}
            </span>
            {c.in_their_words && <span className="text-xs text-muted-foreground">in their words</span>}
            {c.persona && c.persona !== "table" && (
              <span className="text-xs text-muted-foreground">in character</span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(c.seconds)}s</span>
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
  )
}
