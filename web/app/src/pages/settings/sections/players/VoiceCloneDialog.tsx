import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Speech, Trash2, WandSparkles } from "lucide-react"
import { useState } from "react"
import { useCampaign, type CampaignJob } from "@troubadour/api/campaign"
import {
  useBuildClone,
  useCloneSay,
  useClones,
  useDeleteClip,
  type CloneClip,
  type CloneVoice,
} from "@troubadour/api/clones"
import { useIdle, useLive } from "@troubadour/api/live"
import { keys } from "@troubadour/api/query"
import { useUpdatePlayer, type Player } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@troubadour/ui/dialog"
import { NativeSelect } from "@troubadour/ui/native-select"
import { Switch } from "@troubadour/ui/switch"
import { Textarea } from "@troubadour/ui/textarea"
import { notify } from "@troubadour/ui/toast"
import { JobStatus } from "../../../../components/jobs/JobStatus.tsx"
import { jobActive } from "../../../../components/jobs/progress.ts"
import { SpeechProfile } from "./SpeechProfile.tsx"
import { TheirWordsSwitch } from "../../../../components/read-aloud/TheirWordsSwitch.tsx"

const SAY_MAX = 2000 // tts.SAY_MAX_CHARS

const LIKENESS_HELP =
  "How close the preview sounds to their voice at the table, to the speaker recognition (1 = the same). " +
  "A clean clone of a noisy room scores a bit lower than the room itself would."

const onError = (e: Error) => notify(e.message, { tone: "danger" })

/** A player's voice clone: their consent, their speech profile, building the voice, a preview, and typed
 * lines spoken in their voice. Nothing plays until clicked. */
export function VoiceCloneDialog({
  playerId,
  open,
  onOpenChange,
}: {
  playerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // From the live store, not a prop: the consent switch changes it.
  const player = useLive((s) => s.players.find((p) => p.id === playerId))
  const clones = useClones().data
  const jobs = useCampaign().data?.jobs ?? []
  const idle = useIdle()
  const update = useUpdatePlayer()
  const client = useQueryClient()
  const [confirmingOff, setConfirmingOff] = useState(false)

  if (!player) return null

  const latest = (kind: CampaignJob["kind"]) =>
    jobs.filter((j) => j.kind === kind && j.player_id === player.id).at(-1)
  const building = latest("clone")
  const saying = latest("say")
  const voice = clones?.voices[player.id]
  const profile = clones?.profiles[player.id]
  const clips = (clones?.clips ?? []).filter((c) => c.player_id === player.id && c.kind === "say")
  const busy = [building, saying].some((j) => j && jobActive(j))
  const blocked = !idle ? "Stop the session first" : busy ? "Wait for the current job" : undefined
  const made = !!voice || !!profile || clips.length > 0

  // Turning it off deletes the voice, profile and clips on the server: refetch what's left.
  const setConsent = (on: boolean) =>
    update.mutate(
      { id: player.id, patch: { clone_ok: on } },
      { onSuccess: () => client.invalidateQueries({ queryKey: keys.clones() }), onError },
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`${player.name}'s voice clone`}
          description={`Troubadour can speak in ${player.name}'s voice, copied from their Train recording or the cleanest stretch of their talk in your sessions, and in each character they voice. It all stays on this Mac.`}
        />
        <DialogBody className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-14">
            <Switch
              checked={player.clone_ok}
              onCheckedChange={(on: boolean) => (!on && made ? setConfirmingOff(true) : setConsent(on))}
            />
            {player.name} agrees to a voice clone
          </label>

          <SpeechProfile player={player} profile={profile} job={latest("profile")} />

          {player.clone_ok && clones?.available === false && (
            <p className="text-13 text-ink-muted">
              Voice clones need a Mac with Apple Silicon. The speech profile above works here.
            </p>
          )}
          {player.clone_ok && clones?.available !== false && (
            <div className="flex flex-col gap-4">
              {player.trained ? (
                <BuildVoice player={player} voice={voice} job={building} blocked={blocked} />
              ) : (
                <p className="text-13 text-ink-muted">
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
        </DialogBody>
      </DialogContent>
      <ConfirmDialog
        open={confirmingOff}
        onOpenChange={setConfirmingOff}
        title={`Turn off ${player.name}'s voice clone?`}
        body={`Delete ${player.name}'s voice clone, speech profile and every clip made with them?`}
        confirmLabel="Delete them"
        tone="danger"
        onConfirm={async () => {
          await update.mutateAsync({ id: player.id, patch: { clone_ok: false } })
          await client.invalidateQueries({ queryKey: keys.clones() })
        }}
      />
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
  const build = useBuildClone()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          disabled={!!blocked || build.isPending}
          title={blocked}
          onClick={() => build.mutate(player.id, { onError })}
        >
          {job && jobActive(job) ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <WandSparkles className="size-3.5" />
          )}
          {voice ? "Rebuild voices" : "Build voice"}
        </Button>
      </div>
      {job && <JobStatus job={job} variant="inline" />}
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
    <div className="flex flex-col gap-1">
      <p className="text-12 text-ink-muted tabular-nums" title={[LIKENESS_HELP, ...tried].join("\n")}>
        <span className="font-semibold text-ink">{name}</span>
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
        <p className="text-12 text-ink-muted">
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
  const say = useCloneSay()
  const [text, setText] = useState("")
  const [theirWords, setTheirWords] = useState(false)
  const [persona, setPersona] = useState("table")
  const own = persona === "table"
  const label = `Something for ${player.name} to say`
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        say.mutate(
          { id: player.id, text: text.trim(), inTheirWords: own && theirWords && profiled, persona },
          { onSuccess: () => setText(""), onError },
        )
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
        <Button
          type="submit"
          variant="primary"
          disabled={!text.trim() || !!blocked || say.isPending}
          title={blocked}
        >
          {job && jobActive(job) ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Speech className="size-3.5" />
          )}{" "}
          Speak
        </Button>
        {characters.length > 0 && (
          <div className="w-44">
            <NativeSelect aria-label="Voice" value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="table">Their own voice</option>
              {characters.map((c) => (
                <option key={c.persona} value={c.persona}>
                  As {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <TheirWordsSwitch
          profiled={profiled && own}
          checked={theirWords}
          onChange={setTheirWords}
          missing={own ? "Profile how they talk first" : "For their own voice"}
        />
      </div>
      {job && <JobStatus job={job} variant="inline" />}
    </form>
  )
}

function ClipList({ player, clips }: { player: Player; clips: CloneClip[] }) {
  const remove = useDeleteClip()
  return (
    <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
      {clips.map((c) => (
        <li key={c.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-14">
            <span className="flex-1 truncate" title={c.text}>
              {c.title}
            </span>
            {c.in_their_words && <span className="text-12 text-ink-muted">in their words</span>}
            {c.persona && c.persona !== "table" && (
              <span className="text-12 text-ink-muted">in character</span>
            )}
            <span className="text-12 text-ink-muted tabular-nums">{Math.round(c.seconds)}s</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete "${c.title}"`}
              onClick={() => remove.mutate({ id: player.id, clip: c.id }, { onError })}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <audio controls preload="none" src={c.url} className="h-8 w-full" />
        </li>
      ))}
    </ul>
  )
}
