import { useEffect, useRef, useState } from "react"
import { AudioWaveform, CircleCheck, CircleDashed, Ellipsis, Palette, UserMinus, Trash2 } from "lucide-react"
import { classColorVar } from "@yipe/tokens/classes"
import { useLive } from "@troubadour/api/live"
import {
  useBenchPlayer,
  useClasses,
  useDeletePlayer,
  useUpdatePlayer,
  type Player,
  type PlayerPatch,
} from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { ColorSwatchPicker } from "@troubadour/ui/color-swatch-picker"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { Input } from "@troubadour/ui/input"
import { NativeSelect } from "@troubadour/ui/native-select"
import { notify } from "@troubadour/ui/toast"
import { playerColor } from "../../lib/players.ts"
import { PlayerAvatar } from "../people/PlayerAvatar.tsx"
import { AddClassDialog } from "./AddClassDialog.tsx"
import { fileToAvatar } from "./fileToAvatar.ts"
import { TrainDialog } from "./TrainDialog.tsx"

export const ROW_GRID =
  "grid min-w-[880px] grid-cols-[52px_1.1fr_1.3fr_1fr_100px_220px_32px] items-center gap-3 px-4"

const ADD_CLASS = "__add__"
const UNKNOWN_CLASS = "__unknown__"

/**
 * An optimistic local value over a server value. When the server's value changes (an event), it
 * replaces the local one: the server is the truth.
 */
function useDraft<T>(server: T): [T, (value: T) => void] {
  const [draft, setDraft] = useState({ server, value: server })
  if (!Object.is(draft.server, server)) setDraft({ server, value: server })
  return [Object.is(draft.server, server) ? draft.value : server, (value) => setDraft({ server, value })]
}

export function PlayerRow({ player, focus }: { player: Player; focus: boolean }) {
  const classes = useClasses().data ?? []
  const idle = useLive((s) => (s.session?.status ?? "idle") === "idle")
  const serverError = useLive((s) => !!s.session?.error)
  // Players trained before voices could carry characters show up as a named voice with no character.
  const trained = useLive(
    (s) =>
      player.trained ||
      s.voices.some(
        (v) => v.status === "named" && v.trained && v.player_id === player.id && v.character == null,
      ),
  )
  const update = useUpdatePlayer()
  const bench = useBenchPlayer()
  const remove = useDeletePlayer()

  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useDraft(player.name)
  const [character, setCharacter] = useDraft(player.character)
  const [dndClass, setDndClass] = useDraft(player.dnd_class)
  const [isGm, setIsGm] = useDraft(player.is_gm)
  const [training, setTraining] = useState(false)
  const [addingClass, setAddingClass] = useState(false)
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (focus) nameRef.current?.select()
  }, [focus])

  const save = (patch: PlayerPatch, rollback: () => void = () => {}) =>
    update.mutate(
      { id: player.id, patch },
      {
        onError: (e) => {
          rollback()
          notify(e.message, { tone: "danger" })
        },
      },
    )

  const commitName = () => {
    const v = name.trim()
    if (!v) return setName(player.name)
    setName(v)
    if (v !== player.name) save({ name: v }, () => setName(player.name))
  }

  const commitCharacter = () => {
    const v = character.trim()
    setCharacter(v)
    if (v !== player.character) save({ character: v }, () => setCharacter(player.character))
  }

  const pickClass = (value: string) => {
    if (value === ADD_CLASS) return setAddingClass(true)
    if (value === UNKNOWN_CLASS) return
    const next = value || null
    const before = dndClass
    setDndClass(next)
    save({ dnd_class: next }, () => setDndClass(before))
  }

  const pickRole = (gm: boolean) => {
    const before = isGm
    setIsGm(gm)
    save({ is_gm: gm }, () => setIsGm(before))
  }

  const classSelectedKnown = !dndClass || classes.some((c) => c.id === dndClass)
  // Show the class colour the player would have with the optimistic class chosen.
  const dot = playerColor({ ...player, dnd_class: dndClass }, classes)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      save({ avatar: await fileToAvatar(file) })
    } catch {
      notify("Couldn't read that image", { tone: "danger" })
    }
  }

  const builtIns = classes.filter((c) => c.builtin)
  const custom = classes.filter((c) => !c.builtin)

  return (
    <div className={`${ROW_GRID} border-t border-line bg-surface py-2.5`} role="row">
      <button
        type="button"
        title="Upload avatar"
        aria-label={`Upload an avatar for ${player.name}`}
        className="cursor-pointer rounded-full"
        onClick={() => fileRef.current?.click()}
      >
        <PlayerAvatar player={player} size={36} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <Input
        ref={nameRef}
        aria-label={`Player name for ${player.name}`}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <Input
        aria-label={`Character for ${player.name}`}
        value={character}
        maxLength={80}
        placeholder={player.is_gm ? "Game master" : "Character name"}
        onChange={(e) => setCharacter(e.target.value)}
        onBlur={commitCharacter}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <NativeSelect
        aria-label={`Class for ${player.name}`}
        value={classSelectedKnown ? (dndClass ?? "") : UNKNOWN_CLASS}
        onChange={(e) => pickClass(e.target.value)}
        leading={<span className="size-2 rounded-sm" style={{ backgroundColor: dot }} />}
      >
        {builtIns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
        {custom.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
        {!classSelectedKnown && <option value={UNKNOWN_CLASS}>Unknown class</option>}
        <option value="">—</option>
        <option value={ADD_CLASS}>Add a class…</option>
      </NativeSelect>
      <NativeSelect
        aria-label={`Role for ${player.name}`}
        value={isGm ? "gm" : "player"}
        onChange={(e) => pickRole(e.target.value === "gm")}
        className={isGm ? "font-semibold" : undefined}
        style={isGm ? { color: classColorVar("paladin") } : undefined}
      >
        <option value="player">Player</option>
        <option value="gm">GM</option>
      </NativeSelect>
      <span className="flex items-center gap-2.5 text-13">
        <span
          className={`flex items-center gap-1.5 whitespace-nowrap ${trained ? "text-success" : "text-ink-subtle"}`}
        >
          {trained ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />}
          {trained ? "Trained" : "Learns in play"}
        </span>
        <Button size="sm" disabled={serverError} onClick={() => setTraining(true)}>
          <AudioWaveform className="size-3" />
          {trained ? "Retrain" : "Train"}
        </Button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More for ${player.name}`}
          className="flex size-8 cursor-pointer items-center justify-center rounded-control text-ink-subtle hover:bg-elevated hover:text-ink"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem icon={<Palette />} onClick={() => setPicking(true)}>
            Custom colour
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<UserMinus />}
            disabled={!idle}
            onClick={() => bench.mutate(player.id, { onError: (e) => notify(e.message, { tone: "danger" }) })}
          >
            {idle ? "Bench" : "Bench (stop the session first)"}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Trash2 />} danger onClick={() => setRemoving(true)}>
            Remove for good
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {training && <TrainDialog player={player} open={training} onOpenChange={setTraining} />}
      <AddClassDialog
        open={addingClass}
        onOpenChange={setAddingClass}
        onAdded={(cls) => {
          const before = dndClass
          setDndClass(cls.id)
          save({ dnd_class: cls.id }, () => setDndClass(before))
        }}
      />
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader title={`${player.name}'s colour`} description="Overrides the class colour." />
          <DialogBody>
            <ColorSwatchPicker
              label="Colour"
              value={player.color}
              allowClear
              onChange={(hex) => save({ color: hex })}
            />
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setPicking(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${player.name} for good?`}
        body="This deletes them from every campaign, with their voice training. To keep their voice, bench them instead."
        confirmLabel="Remove for good"
        tone="danger"
        onConfirm={() => remove.mutateAsync(player.id)}
      />
    </div>
  )
}
