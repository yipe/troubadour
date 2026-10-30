import { useMutation } from "@tanstack/react-query"
import { useState, type CSSProperties } from "react"
import { useLive } from "@troubadour/api/live"
import { useClasses, type Player } from "@troubadour/api/players"
import { assignMessage } from "@troubadour/api/session"
import { Input } from "@troubadour/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"
import { notify } from "@troubadour/ui/toast"
import { PlayerAvatar } from "../../../components/people/PlayerAvatar.tsx"
import { playerColor } from "../../../lib/players.ts"

export interface LineSpeakerPickerProps {
  messageId: string
  /** Where the clicked speaker name sits on screen; the popover opens against it. */
  anchor: DOMRect
  onClose: () => void
}

interface Option {
  key: string
  player: Player
  character: string | null
  label: string
}

/**
 * Who said this one line: pick a player and the line is theirs at once (the server pins it and learns
 * their voice from it). Characters someone already voices are offered too; typing a character applies
 * it to whichever player is picked.
 */
export function LineSpeakerPicker({ messageId, anchor, onClose }: LineSpeakerPickerProps) {
  const players = useLive((s) => s.players)
  const voices = useLive((s) => s.voices)
  const classes = useClasses().data ?? []
  const [typed, setTyped] = useState("")
  const character = typed.trim() || null

  const assign = useMutation({
    mutationFn: (o: Option) => assignMessage(messageId, o.player.id, o.character),
    onSuccess: onClose,
    onError: (e: Error) => notify(e.message, { tone: "danger" }),
  })

  // Each player as themselves (or as the typed character), then the characters already voiced.
  const options: Option[] = players.map((p) => ({
    key: p.id,
    player: p,
    character,
    label: character ? `as ${character}` : p.character,
  }))
  if (!character) {
    for (const v of voices) {
      const player = players.find((p) => p.id === v.player_id)
      if (v.status === "named" && v.character && player) {
        options.push({ key: v.id, player, character: v.character, label: `as ${v.character}` })
      }
    }
  }

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      {/* An invisible stand-in for the clicked name: the popover anchors to its trigger. */}
      <PopoverTrigger
        nativeButton={false}
        render={
          <span
            aria-hidden
            className="pointer-events-none fixed"
            style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
          />
        }
      />
      <PopoverContent align="start" className="w-64 space-y-2 p-2">
        <p className="px-1 text-12 text-ink-subtle">Who said this line?</p>
        {players.length === 0 ? (
          <p className="px-1 text-12 text-ink-subtle">Add players in Settings first.</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {options.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    disabled={assign.isPending}
                    onClick={() => assign.mutate(o)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-left hover:bg-elevated disabled:opacity-50"
                  >
                    <PlayerAvatar player={o.player} size={24} />
                    <span
                      style={{ "--player": playerColor(o.player, classes) } as CSSProperties}
                      className="text-(--player)"
                    >
                      {o.player.name}
                    </span>{" "}
                    <span className="truncate text-ink-subtle">{o.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Input
              placeholder="As a character / NPC (optional)"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
