import { useState } from "react"
import { Link, useNavigate, type NavigateFunction } from "react-router"
import { ChevronsUpDown, GitMerge, Lock, Trash2 } from "lucide-react"
import {
  useCampaign,
  useDeleteEntity,
  useMergeEntity,
  useMutateEntity,
  type Entity,
  type EntityType,
} from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@troubadour/ui/command"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { NativeSelect } from "@troubadour/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"
import { SectionLabel } from "@troubadour/ui/section-label"
import { Textarea } from "@troubadour/ui/textarea"
import { ENTITY_TYPES, TYPE_LABEL } from "../../../lib/entities.ts"
import { paths } from "../../../paths.ts"
import { ChipEditor } from "./ChipEditor.tsx"

export type EditEntryDialogProps = {
  entity: Entity
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditEntryDialog({ entity, open, onOpenChange }: EditEntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <EditForm entity={entity} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** Lists are saved as changes against the entry as it is when the write runs, so a spelling accepted meanwhile survives. */
function applyListEdit(latest: string[], initial: string[], draft: string[]): string[] {
  const removed = initial.filter((x) => !draft.includes(x))
  const added = draft.filter(
    (x) => !initial.includes(x) && !latest.some((l) => l.toLowerCase() === x.toLowerCase()),
  )
  return [...latest.filter((x) => !removed.includes(x)), ...added]
}

/**
 * Open an entry once the codex has settled. The cache already holds the new name when the write
 * resolves, so the codex page has by then redirected (to its first entry) from the name in the old URL;
 * navigating at once would lose to that redirect.
 */
function openLater(navigate: NavigateFunction, entry: string | undefined, replace = false) {
  setTimeout(() => navigate(paths.codex(entry), { replace }), 0)
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function EditForm({ entity, close }: { entity: Entity; close: () => void }) {
  const navigate = useNavigate()
  const update = useMutateEntity()
  const [name, setName] = useState(entity.name)
  const [type, setType] = useState<EntityType>(entity.type)
  const [description, setDescription] = useState(entity.description)
  const [aliases, setAliases] = useState(entity.aliases)
  const [heardAs, setHeardAs] = useState(entity.heard_as)
  const [error, setError] = useState<string | null>(null)
  const readOnly = entity.read_only
  const newName = name.trim()

  async function save() {
    setError(null)
    try {
      const saved = await update.mutateAsync({
        name: entity.name,
        change: (latest) => {
          const patch = {
            ...(newName !== latest.name && { name: newName }),
            ...(type !== latest.type && { type }),
            ...(description !== latest.description && { description }),
            ...(!sameList(aliases, entity.aliases) && {
              aliases: applyListEdit(latest.aliases, entity.aliases, aliases),
            }),
            ...(!sameList(heardAs, entity.heard_as) && {
              heard_as: applyListEdit(latest.heard_as, entity.heard_as, heardAs),
            }),
          }
          return Object.keys(patch).length > 0 ? patch : undefined
        },
      })
      if (saved && saved.name !== entity.name) openLater(navigate, saved.name, true)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <DialogHeader title="Edit entry" description={entity.name} />
      <DialogBody className="flex flex-col gap-5">
        {readOnly ? (
          <div role="status" className="flex items-center gap-2 rounded-control bg-warning-faint p-3 text-13">
            <Lock aria-hidden className="size-4 shrink-0" />
            This note's properties can't be read. Fix it in Obsidian.
          </div>
        ) : null}
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Type">
              <NativeSelect value={type} onChange={(e) => setType(e.target.value as EntityType)}>
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Description">
            <Textarea
              value={description}
              placeholder="Who or what this is, in a sentence or two."
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <section className="flex flex-col gap-2">
            <SectionLabel>Aliases</SectionLabel>
            <ChipEditor label="alias" values={aliases} onChange={setAliases} placeholder="Add alias…" />
          </section>
          <section className="flex flex-col gap-2">
            <SectionLabel>Heard as</SectionLabel>
            <p className="text-12 text-ink-subtle">
              How speech-to-text misspells it; Troubadour fixes these in new transcripts.{" "}
              <Link to={paths.settings("vault")} className="text-accent hover:underline">
                Ignored words
              </Link>
            </p>
            <ChipEditor label="spelling" values={heardAs} onChange={setHeardAs} placeholder="Add spelling…" />
          </section>
        </fieldset>
        {readOnly ? null : <DangerZone entity={entity} onGone={close} />}
        {error ? (
          <p role="alert" className="text-13 text-danger">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" disabled={readOnly || !newName || update.isPending} onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}

function DangerZone({ entity, onGone }: { entity: Entity; onGone: () => void }) {
  const navigate = useNavigate()
  const entities = useCampaign().data?.entities ?? []
  const merge = useMergeEntity()
  const del = useDeleteEntity()
  const [picking, setPicking] = useState(false)
  const [into, setInto] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const options = entities
    .filter((e) => e.name !== entity.name)
    .sort((a, b) => a.name.localeCompare(b.name, "en-US", { sensitivity: "base" }))

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <SectionLabel>Danger zone</SectionLabel>
      <div className="flex items-center gap-2">
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger
            render={
              <Button aria-expanded={picking}>
                <GitMerge aria-hidden className="size-3.5" />
                Merge into…
                <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />
              </Button>
            }
          />
          <PopoverContent align="start" className="w-72 p-0">
            <Command label="Merge into">
              <CommandInput placeholder="Search entries…" />
              <CommandList>
                <CommandEmpty>No matching entry.</CommandEmpty>
                {options.map((e) => (
                  <CommandItem
                    key={e.name}
                    value={e.name}
                    keywords={[...e.aliases, ...e.heard_as]}
                    onSelect={() => {
                      setPicking(false)
                      setInto(e.name)
                    }}
                  >
                    <span className="truncate">{e.name}</span>
                    <span className="ml-auto text-12 text-ink-subtle">{TYPE_LABEL[e.type]}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button variant="danger" className="ml-auto" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden className="size-3.5" />
          Delete
        </Button>
      </div>
      <ConfirmDialog
        open={into !== null}
        onOpenChange={(o) => !o && setInto(null)}
        title={`Merge into ${into ?? ""}?`}
        body={
          <>
            {entity.name} is folded into {into}. Its names become aliases of {into}.
          </>
        }
        confirmLabel="Merge"
        tone="primary"
        onConfirm={async () => {
          const merged = await merge.mutateAsync({ name: entity.name, into: into! })
          onGone()
          openLater(navigate, merged?.name)
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${entity.name}?`}
        body="Moves the note to .trash/ in the vault. You can recover it in Obsidian."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          await del.mutateAsync(entity.name)
          onGone()
          navigate(paths.codex())
        }}
      />
    </section>
  )
}
