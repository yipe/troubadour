import { Volume2 } from "lucide-react"
import { useState } from "react"
import { useCampaign } from "@troubadour/api/campaign"
import { useCloneRead, useClones } from "@troubadour/api/clones"
import { useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { NativeSelect } from "@troubadour/ui/native-select"
import { Tooltip } from "@troubadour/ui/tooltip"
import { JobStatus } from "../jobs/JobStatus.tsx"
import { jobActive } from "../jobs/progress.ts"
import { ClipPlayer } from "./ClipPlayer.tsx"
import { TheirWordsSwitch } from "./TheirWordsSwitch.tsx"

export type ReadAloudProps = {
  /** The session whose write-up is read. */
  sessionId: string
  /** The text on screen; when it is given and blank there is nothing to read. */
  text?: string
  /** Pre-selects this player's voice when they have one. */
  defaultPlayerId?: string
}

const NO_CLONES = "Make a voice clone in Settings › Players & voices"

/** Reads a session's write-up aloud in a player's cloned voice. The clip never plays on its own. */
export function ReadAloud({ sessionId, text, defaultPlayerId }: ReadAloudProps) {
  const clones = useClones().data
  const players = useLive((s) => s.players)
  const jobs = useCampaign().data?.jobs ?? []
  const read = useCloneRead()
  const [reader, setReader] = useState(defaultPlayerId ?? "")
  const [theirWords, setTheirWords] = useState(false)

  // Every voice that can read: each player's own, then each character they voice.
  const readers = players
    .filter((p) => p.clone_ok && clones?.voices[p.id])
    .flatMap((p) => [
      { key: p.id, playerId: p.id, persona: "table", name: p.name },
      ...(clones?.voices[p.id]?.characters ?? []).map((c) => ({
        key: `${p.id}/${c.persona}`,
        playerId: p.id,
        persona: c.persona ?? "table",
        name: `${p.name} as ${c.label}`,
      })),
    ])
  const pick = readers.find((r) => r.key === reader) ?? readers[0]
  const profiled = !!pick && pick.persona === "table" && !!clones?.profiles[pick.playerId]
  // useJob filters by kind only; one player's read must not show another's.
  const job = pick
    ? jobs.filter((j) => j.kind === "read" && j.player_id === pick.playerId && j.title === sessionId).at(-1)
    : undefined
  const running = !!job && jobActive(job)
  const clip = clones?.clips.find((c) => c.kind === "read" && c.source.session === sessionId)
  const nothing = text !== undefined && text.trim() === ""

  if (!pick) {
    return (
      <Tooltip content={NO_CLONES}>
        <span tabIndex={0} className="inline-flex w-fit">
          <Button size="sm" variant="secondary" disabled>
            <Volume2 />
            Read aloud
          </Button>
        </span>
      </Tooltip>
    )
  }

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={running || nothing || read.isPending}
          onClick={() =>
            read.mutate({
              id: pick.playerId,
              session: sessionId,
              inTheirWords: theirWords && profiled,
              persona: pick.persona,
            })
          }
        >
          <Volume2 />
          Read aloud in {pick.name}&apos;s voice
        </Button>
        {readers.length > 1 && (
          <div className="w-48">
            <NativeSelect aria-label="Read by" value={pick.key} onChange={(e) => setReader(e.target.value)}>
              {readers.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <TheirWordsSwitch
          profiled={profiled}
          checked={theirWords}
          onChange={setTheirWords}
          missing={
            pick.persona === "table" ? "Profile how they talk first (Settings)" : "For their own voice"
          }
        />
      </div>
      {job && <JobStatus job={job} variant="inline" />}
      {clip && !running && <ClipPlayer key={clip.id} src={clip.url} label="read-aloud clip" />}
    </div>
  )
}
