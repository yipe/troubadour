import { useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import {
  useCampaigns,
  useCreateCampaign,
  useOpenCampaign,
  useRenameCampaign,
} from "@troubadour/api/campaigns"
import { useSessions } from "@troubadour/api/sessions"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { notify } from "@troubadour/ui/toast"
import { paths } from "../../paths.ts"

export const CAMPAIGN_FORM = "welcome-campaign"
const MAX_NAME = 60

/**
 * Step 1. Creates a campaign and opens it, or, when the open one has no sessions yet (the first run's
 * blank campaign), renames it. `?new=1` (from the campaign switcher) always creates.
 */
export function CampaignStep({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const campaigns = useCampaigns().data
  const sessions = useSessions()
  const create = useCreateCampaign()
  const open = useOpenCampaign()
  const rename = useRenameCampaign()
  const madeId = useRef<string | null>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const [typedTable, setTypedTable] = useState<string | null>(null)

  const current = campaigns?.campaigns.find((c) => c.id === campaigns.campaign)
  const forceNew = params.get("new") === "1"
  const renaming = !forceNew && !!current && sessions.data?.length === 0
  const name = typed ?? (renaming ? current.name : "")
  const trimmed = name.trim()
  const table = (typedTable ?? (renaming ? current.table_name : "")).trim()
  const error = trimmed.length > MAX_NAME ? `Keep it to ${MAX_NAME} characters or fewer.` : undefined
  const tableError = table.length > MAX_NAME ? `Keep it to ${MAX_NAME} characters or fewer.` : undefined
  const ready = forceNew || sessions.isSuccess

  const submit = async () => {
    if (!trimmed || error || tableError || !ready) return
    onBusy(true)
    try {
      if (renaming) {
        const patch = {
          ...(trimmed !== current.name && { name: trimmed }),
          ...(table !== current.table_name.trim() && { table_name: table }),
        }
        if (Object.keys(patch).length > 0) await rename.mutateAsync({ id: current.id, ...patch })
      } else {
        // Kept across retries: a failed rename or open must not create a second campaign.
        madeId.current ??= (await create.mutateAsync(trimmed)).id
        if (table) await rename.mutateAsync({ id: madeId.current, table_name: table })
        await open.mutateAsync(madeId.current)
      }
      await navigate(paths.welcome("table"))
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t save the campaign.", { tone: "danger" })
    } finally {
      onBusy(false)
    }
  }

  return (
    <form
      id={CAMPAIGN_FORM}
      className="flex max-w-[560px] flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Field label="Campaign name" error={error}>
        <Input
          autoFocus
          maxLength={MAX_NAME + 20}
          value={name}
          placeholder="Sunken Crown"
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <Field
        label="Your table’s name"
        hint="What the party calls itself. Leave empty for “The table”."
        error={tableError}
      >
        <Input
          maxLength={MAX_NAME + 20}
          value={typedTable ?? (renaming ? current.table_name : "")}
          placeholder="e.g. Magic Mushroom Mob"
          onChange={(e) => setTypedTable(e.target.value)}
        />
      </Field>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-12 text-ink-subtle">Notes vault</legend>
        <label className="flex items-start gap-2.5 rounded-card border border-accent-strong/40 bg-surface px-3.5 py-3">
          <input
            type="radio"
            name="vault"
            defaultChecked
            className="mt-1 accent-[var(--color-accent-strong)]"
          />
          <span>
            <span className="block font-semibold">New vault folder</span>
            <span className="block text-13 text-ink-subtle">
              Troubadour makes a folder for this campaign’s notes and keeps it up to date.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 rounded-card border border-line bg-surface px-3.5 py-3 opacity-60">
          <input type="radio" name="vault" disabled className="mt-1" />
          <span>
            <span className="block font-semibold">Use an existing folder</span>
            <span className="block text-13 text-ink-subtle">
              Not available yet: the server can’t adopt a folder you already have. Import its notes in step 4
              instead.
            </span>
          </span>
        </label>
      </fieldset>
    </form>
  )
}
