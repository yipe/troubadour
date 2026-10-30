import { useEffect, useMemo, useRef, useState } from "react"
import { AudioLines, Undo2 } from "lucide-react"
import { useLive } from "@troubadour/api/live"
import type { Player } from "@troubadour/api/players"
import type { Voice } from "@troubadour/api/session"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { cn } from "@troubadour/ui/cn"
import { Input } from "@troubadour/ui/input"
import { NativeSelect } from "@troubadour/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"
import { PlayerAvatar } from "../../components/people/PlayerAvatar.tsx"
import { speakerFor } from "../../lib/players.ts"
import { SamplePlayButton } from "./SamplePlayButton.tsx"
import { useAssignVoice, useUnassignVoice } from "./useVoiceActions.ts"

/** Pending voices shown before "Show all"; the longest-heard come first. */
export const PENDING_CAP = 8

export function VoicesPopover() {
  const count = useLive((s) => s.voices.length)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <AudioLines className="size-4" /> Voices
            {count > 0 && <span className="ml-auto text-ink-subtle tabular-nums">{count}</span>}
          </Button>
        }
      />
      <PopoverContent side="right" align="end" className="max-h-[70vh] w-80 overflow-y-auto p-3">
        <VoicesList />
      </PopoverContent>
    </Popover>
  )
}

export function VoicesList() {
  const voices = useLive((s) => s.voices)
  const players = useLive((s) => s.players)
  const focusId = useLive((s) => s.focus?.voiceId ?? null)
  const [showAll, setShowAll] = useState(false)
  const named = voices.filter((v) => v.status === "named")
  const pending = useMemo(
    () => voices.filter((v) => v.status === "pending").sort((a, b) => b.seconds - a.seconds),
    [voices],
  )
  const shown = useMemo(() => {
    if (showAll) return pending
    const top = pending.slice(0, PENDING_CAP)
    // A voice focused from the transcript ("Name this voice") stays visible outside the top N.
    const focused = pending.find((v) => v.id === focusId)
    return focused && !top.includes(focused) ? [...top, focused] : top
  }, [pending, showAll, focusId])

  return (
    <div className="flex flex-col gap-3">
      {voices.length === 0 && (
        <p className="text-13 text-ink-subtle">No voices yet. They appear here as people speak.</p>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shown.map((v) => (
            <PendingRow key={v.id} voice={v} players={players} />
          ))}
        </ul>
      )}
      {pending.length > PENDING_CAP && (
        <Button size="sm" variant="ghost" onClick={() => setShowAll((x) => !x)}>
          {showAll ? "Show fewer" : `Show all (${pending.length})`}
        </Button>
      )}
      {named.length > 0 && (
        <ul className="flex flex-col gap-1">
          {named.map((v) => (
            <NamedRow key={v.id} voice={v} players={players} voices={voices} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PendingRow({ voice, players }: { voice: Voice; players: Player[] }) {
  const focus = useLive((s) => (s.focus?.voiceId === voice.id ? s.focus.n : 0))
  const ref = useRef<HTMLLIElement>(null)
  const assign = useAssignVoice()
  const [playerId, setPlayerId] = useState("")
  const [character, setCharacter] = useState("")
  const suggested = players.find((p) => p.id === voice.suggested_player_id)
  const chosen = players.find((p) => p.id === playerId)

  useEffect(() => {
    if (!focus) return
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [focus])

  return (
    <li
      ref={ref}
      className={cn("flex flex-col gap-2 rounded-control border border-dashed border-line-strong p-2.5")}
    >
      <div className="flex items-center gap-2">
        <span className="text-13 font-semibold">{voice.label}</span>
        <span className="text-12 text-ink-subtle tabular-nums">{Math.round(voice.seconds)} s heard</span>
        {voice.sample_url && (
          <span className="ml-auto">
            <SamplePlayButton url={voice.sample_url} />
          </span>
        )}
      </div>
      {suggested && (
        <Button
          size="sm"
          variant="secondary"
          disabled={assign.isPending}
          onClick={() => assign.mutate({ voice, player: suggested, character: null })}
        >
          {suggested.name}?
          {voice.suggested_score != null && (
            <span className="text-ink-subtle tabular-nums">{Math.round(voice.suggested_score * 100)}%</span>
          )}
        </Button>
      )}
      {players.length === 0 ? (
        <p className="text-12 text-ink-subtle">Add players in Settings to name this voice.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <NativeSelect
            aria-label={`Who is ${voice.label}?`}
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
          >
            <option value="">Who is this?</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <div className="flex gap-1.5">
            <Input
              aria-label={`Character for ${voice.label}`}
              placeholder="Character / NPC (optional)"
              value={character}
              onChange={(e) => setCharacter(e.target.value)}
            />
            <Button
              size="md"
              variant="primary"
              disabled={!chosen || assign.isPending}
              onClick={() =>
                chosen && assign.mutate({ voice, player: chosen, character: character.trim() || null })
              }
            >
              Assign
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function NamedRow({ voice, players, voices }: { voice: Voice; players: Player[]; voices: Voice[] }) {
  const unassign = useUnassignVoice()
  const { player, character } = speakerFor(voice.id, voices, players)
  return (
    <li className="flex items-center gap-2 py-1">
      {player ? <PlayerAvatar player={player} size={24} /> : <PlayerAvatar name={voice.label} size={24} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-13 font-semibold">{player?.name ?? voice.label}</span>
          {voice.trained && <Badge tone="neutral">trained</Badge>}
        </div>
        {character && <div className="truncate text-12 text-ink-subtle">{character}</div>}
      </div>
      {voice.sample_url && <SamplePlayButton url={voice.sample_url} />}
      <button
        type="button"
        aria-label={`Unassign ${voice.label}`}
        title="Unassign"
        disabled={unassign.isPending}
        className="flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-elevated hover:text-ink disabled:opacity-50"
        onClick={() => unassign.mutate(voice)}
      >
        <Undo2 className="size-3.5" />
      </button>
    </li>
  )
}
