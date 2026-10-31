import { useState } from "react"
import { useNavigate } from "react-router"
import { Check, ChevronsUpDown, Pencil, Plus } from "lucide-react"
import { useCampaigns, useOpenCampaign, useRenameCampaign } from "@troubadour/api/campaigns"
import { useCampaign } from "@troubadour/api/campaign"
import { useLive } from "@troubadour/api/live"
import { useClasses } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { notify } from "@troubadour/ui/toast"
import { Tooltip } from "@troubadour/ui/tooltip"
import { playerColor } from "../lib/players.ts"
import { paths } from "../paths.ts"

const MAX_NAME = 60

/** Why a name can't be saved, or null. */
function nameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "Give the campaign a name."
  if (trimmed.length > MAX_NAME) return `Keep it to ${MAX_NAME} characters or fewer.`
  return null
}

/** Top-nav campaign picker. Switching happens between sessions only; the server enforces it too. */
export function CampaignSwitcher() {
  const data = useCampaigns().data
  const navigate = useNavigate()
  const open = useOpenCampaign()
  const running = useLive((s) => (s.session?.status ?? "idle") !== "idle")
  const jobsBusy = useCampaign().data?.jobs.some((j) => j.state === "queued" || j.state === "running")
  const gm = useLive((s) => s.players.find((p) => p.is_gm))
  const classes = useClasses().data ?? []
  const [renaming, setRenaming] = useState<{ id: string; name: string; table_name: string } | null>(null)

  const current = data?.campaigns.find((c) => c.id === data.campaign)
  const reason = running
    ? "Stop the session to switch campaigns."
    : jobsBusy
      ? "Wait for the campaign jobs to finish before switching campaigns."
      : null
  const color = gm ? playerColor(gm, classes) : "var(--color-class-paladin)"

  const switchTo = (id: string) => open.mutate(id, { onError: (e) => notify(e.message, { tone: "danger" }) })

  const button = (
    <DropdownMenuTrigger
      className="flex h-8 cursor-pointer items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-13 font-semibold text-ink"
      aria-label="Campaign"
    >
      <span className="size-2 rounded-[2px]" style={{ background: color }} />
      {current?.name ?? ""}
      <ChevronsUpDown size={14} className="text-ink-subtle" />
    </DropdownMenuTrigger>
  )

  return (
    <>
      <DropdownMenu>
        {reason ? <Tooltip content={reason}>{button}</Tooltip> : button}
        <DropdownMenuContent align="start">
          {data?.campaigns.map((c) => (
            <DropdownMenuItem
              key={c.id}
              disabled={c.id !== data.campaign && !!reason}
              onClick={() => c.id !== data.campaign && switchTo(c.id)}
              icon={c.id === data.campaign ? <Check /> : <span className="size-4" />}
            >
              {c.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Plus />}
            onClick={() => void navigate(`${paths.welcome("campaign")}?new=1`)}
          >
            New campaign…
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Pencil />}
            disabled={!current}
            onClick={() => current && setRenaming(current)}
          >
            Rename…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && <RenameDialog target={renaming} onClose={() => setRenaming(null)} />}
    </>
  )
}

function RenameDialog({
  target,
  onClose,
}: {
  target: { id: string; name: string; table_name: string }
  onClose: () => void
}) {
  const rename = useRenameCampaign()
  const [name, setName] = useState(target.name)
  const [tableName, setTableName] = useState(target.table_name)
  const [touched, setTouched] = useState(false)
  const error = touched ? nameError(name) : null
  const tableError = tableName.trim().length > MAX_NAME ? `Keep it to ${MAX_NAME} characters or fewer.` : null

  const submit = () => {
    setTouched(true)
    if (nameError(name) || tableError) return
    rename.mutate(
      { id: target.id, name: name.trim(), table_name: tableName.trim() },
      { onSuccess: onClose, onError: (e) => notify(e.message, { tone: "danger" }) },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader title="Rename campaign" />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogBody>
            <Field label="Campaign name" error={error ?? undefined}>
              <Input
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setTouched(true)
                }}
              />
            </Field>
            <Field
              label="Table name"
              hint="What the party calls itself. Leave empty for “The table”."
              error={tableError ?? undefined}
            >
              <Input
                value={tableName}
                placeholder="e.g. Magic Mushroom Mob"
                onChange={(e) => setTableName(e.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={rename.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
