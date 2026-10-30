import { useState } from "react"
import type { Player } from "@troubadour/api/players"
import type { Voice } from "@troubadour/api/session"
import { Button } from "@troubadour/ui/button"
import { Input } from "@troubadour/ui/input"
import { cn } from "@troubadour/ui/cn"
import { quickPicks } from "./rail.ts"
import { SamplePlayButton } from "./SamplePlayButton.tsx"
import { useAssignVoice } from "./useVoiceActions.ts"

export interface PendingVoiceCardProps {
  voice: Voice
  /** The players to offer (those at the table). */
  players: Player[]
  /** Hide the card until the next new voice. */
  onLater: () => void
}

const CHIP = "text-12 cursor-pointer rounded-[5px] px-2 py-1 disabled:opacity-50"

/** The newest unnamed voice: who is it? A GM pick asks for the character they are voicing. */
export function PendingVoiceCard({ voice, players, onLater }: PendingVoiceCardProps) {
  const assign = useAssignVoice()
  // The GM being picked: ask which character before assigning.
  const [asking, setAsking] = useState<Player | null>(null)
  const [character, setCharacter] = useState("")
  const picks = quickPicks(voice, players)

  const choose = (player: Player) => {
    if (player.is_gm) setAsking(player)
    else assign.mutate({ voice, player, character: null })
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed border-line-strong p-2.5">
      <div className="flex items-center gap-1.5 text-12 text-ink-muted">
        <span>
          <b className="text-ink">{voice.label}</b> · {Math.round(voice.seconds)} s heard · who is it?
        </span>
        {voice.sample_url && (
          <span className="ml-auto">
            <SamplePlayButton url={voice.sample_url} />
          </span>
        )}
      </div>
      {asking ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            assign.mutate({ voice, player: asking, character: character.trim() || null })
          }}
        >
          <Input
            autoFocus
            aria-label={`Character ${asking.name} is voicing`}
            placeholder={`Which character is ${asking.name} voicing?`}
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" variant="primary" disabled={assign.isPending}>
              Assign
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
              Back
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {picks.map((p) => {
            const suggested = p.id === voice.suggested_player_id
            return (
              <button
                key={p.id}
                type="button"
                disabled={assign.isPending}
                className={cn(
                  CHIP,
                  suggested
                    ? "bg-accent-soft font-semibold text-accent"
                    : "border border-line bg-transparent text-ink hover:bg-elevated",
                )}
                onClick={() => choose(p)}
              >
                {p.is_gm ? `${p.name} as NPC` : p.name}
              </button>
            )
          })}
          <button type="button" className={cn(CHIP, "text-ink-subtle hover:text-ink")} onClick={onLater}>
            Later
          </button>
        </div>
      )}
    </div>
  )
}
