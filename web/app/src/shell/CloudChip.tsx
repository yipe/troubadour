import { Cloud, CloudOff, Laptop } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router"
import { useCampaigns } from "@troubadour/api/campaigns"
import {
  useCloud,
  useCloudBackup,
  useCloudHistory,
  useCloudOptions,
  useCloudRestore,
  useCloudVaults,
} from "@troubadour/api/cloud"
import { useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"
import { StatusDot } from "@troubadour/ui/status-dot"
import { Switch } from "@troubadour/ui/switch"
import { ConnectDialog } from "../components/cloud/ConnectDialog.tsx"
import {
  cloudChipLabel,
  cloudState,
  cloudStateWord,
  cloudTone,
  type CloudContext,
} from "../components/cloud/status.ts"
import { useJob } from "../components/jobs/useJob.ts"
import { paths } from "../paths.ts"

/** The host of the cloud URL, for "players see it at …". */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Re-render every 30 s so "4 min ago" keeps up. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function CloudChip() {
  const status = useCloud().data
  const live = useLive((s) => !!s.session && s.session.status !== "idle")
  const backupJob = useJob("backup")
  const now = useNow()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const campaigns = useCampaigns().data
  const campaignName = campaigns?.campaigns.find((c) => c.id === campaigns.campaign)?.name ?? ""

  const ctx: CloudContext = { backingUp: backupJob.active, live }
  const connected = !!status?.connected
  const tone = status ? cloudTone(status, ctx) : "neutral"
  const Icon = connected ? Cloud : CloudOff
  const label = status ? cloudChipLabel(status, now, ctx) : "Cloud backup"
  const chipClass = `flex h-[30px] items-center gap-1.5 rounded-control border px-2.5 text-12 font-semibold ${
    popoverOpen
      ? "border-accent-strong bg-accent-soft text-accent"
      : "border-line text-ink-muted hover:text-ink"
  }`
  const content = (
    <>
      <Icon size={14} aria-hidden />
      {connected ? (
        <>
          <StatusDot tone={tone} />
          {label}
        </>
      ) : null}
    </>
  )

  return (
    <>
      {connected && status ? (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger className={chipClass} aria-label={label}>
            {content}
          </PopoverTrigger>
          <PopoverContent className="w-[380px] overflow-hidden" aria-label="Troubadour Cloud">
            <CloudPopoverBody
              now={now}
              ctx={ctx}
              campaignName={campaignName}
              onRestore={() => {
                setPopoverOpen(false)
                setRestoreOpen(true)
              }}
              onNavigate={() => setPopoverOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <button
          type="button"
          className={chipClass}
          aria-label="Cloud backup"
          onClick={() => setConnectOpen(true)}
        >
          {content}
        </button>
      )}
      <ConnectDialog
        open={connectOpen && !connected}
        onOpenChange={setConnectOpen}
        campaignName={campaignName}
      />
      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </>
  )
}

function CloudPopoverBody({
  now,
  ctx,
  campaignName,
  onRestore,
  onNavigate,
}: {
  now: number
  ctx: CloudContext
  campaignName: string
  onRestore: () => void
  onNavigate: () => void
}) {
  const status = useCloud().data!
  const history = useCloudHistory().data
  const backup = useCloudBackup()
  const options = useCloudOptions()
  const tone = cloudTone(status, ctx)
  const state = cloudState(status, ctx)
  const files = status.last_backup?.files
  const changed = history?.attempts.find((a) => a.ok)?.changed
  const facts = [
    campaignName,
    files !== undefined ? `${files.toLocaleString("en-US")} files` : null,
    changed !== undefined ? `${changed.toLocaleString("en-US")} changed` : null,
  ].filter(Boolean)
  const wordTone = {
    success: "text-success",
    danger: "text-danger",
    warning: "text-warning",
    accent: "text-accent",
    neutral: "text-ink-muted",
  }[tone]

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <Cloud size={18} className="text-accent" aria-hidden />
        <span className="font-bold">Troubadour Cloud</span>
        <span className={`ml-auto flex items-center gap-1.5 text-12 ${wordTone}`}>
          <StatusDot tone={tone} />
          {cloudStateWord(status, ctx)}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div>
          <div className="font-semibold">{cloudChipLabel(status, now, ctx)}</div>
          <div className="text-12 text-ink-subtle">{facts.join(" · ")}</div>
          {state === "failed" && status.last_error ? (
            <div className="mt-1 text-12 text-danger">{status.last_error.message}</div>
          ) : null}
          <div className="mt-1 flex items-center gap-1.5 text-12 text-ink-subtle">
            <Laptop size={12} aria-hidden />
            {status.is_main
              ? `This Mac is the main copy · players see it at ${hostOf(status.url)}`
              : `${status.main_device} backed up last; newest backup wins`}
          </div>
        </div>
        <label className="flex items-start gap-2.5">
          <Switch
            className="mt-px"
            checked={status.auto_backup}
            onCheckedChange={(auto_backup) => options.mutate({ auto_backup })}
            aria-label="Back up automatically"
          />
          <span className="leading-tight">
            <span className="block text-13">Back up automatically</span>
            <span className="block text-12 text-ink-subtle">Never during a live session</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5">
          <Switch
            className="mt-px"
            checked={status.include_transcripts}
            onCheckedChange={(include_transcripts) => options.mutate({ include_transcripts })}
            aria-label="Include transcripts"
          />
          <span className="leading-tight">
            <span className="block text-13">Include transcripts</span>
            <span className="block text-12 text-ink-subtle">Audio and voiceprints always stay here</span>
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button
          variant="primary"
          disabled={ctx.backingUp || backup.isPending}
          onClick={() => backup.mutate()}
        >
          Back up now
        </Button>
        <Button variant="ghost" onClick={onRestore}>
          Restore…
        </Button>
        <Link to={paths.settings("cloud")} onClick={onNavigate} className="ml-auto text-12">
          All settings
        </Link>
      </div>
    </>
  )
}

function RestoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const status = useCloud().data
  const vaults = useCloudVaults(open)
  const restore = useCloudRestore()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Restore from Troubadour Cloud?"
      body="This brings back the newest backup of this campaign’s notes. Files it replaces go to .trash in your vault first, so nothing is lost."
      confirmLabel="Restore"
      tone="primary"
      onConfirm={async () => {
        const vault = vaults.data?.find((v) => v.campaign_id === status?.campaign)
        if (!vault) throw new Error("This campaign isn’t in Troubadour Cloud yet. Back it up first.")
        await restore.mutateAsync({ vaultId: vault.id })
      }}
    />
  )
}
