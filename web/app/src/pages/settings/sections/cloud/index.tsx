import { Cloud, CloudOff, ExternalLink, Laptop, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { useCampaigns } from "@troubadour/api/campaigns"
import { useCloud, useCloudBackup, useCloudOptions } from "@troubadour/api/cloud"
import { useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { Card } from "@troubadour/ui/card"
import { IconTile } from "@troubadour/ui/icon-tile"
import { PageHeading } from "@troubadour/ui/page-heading"
import { Spinner } from "@troubadour/ui/spinner"
import { Switch } from "@troubadour/ui/switch"
import { ConnectDialog } from "../../../../components/cloud/ConnectDialog.tsx"
import {
  cloudChipLabel,
  cloudState,
  cloudTone,
  type CloudContext,
} from "../../../../components/cloud/status.ts"
import { useJob } from "../../../../components/jobs/useJob.ts"
import { Sidebar } from "./Sidebar.tsx"
import { WhatGoesUp } from "./WhatGoesUp.tsx"

const SUBTITLE =
  "A backup of each campaign, and the read-only view your players open in a browser. Audio and voiceprints never go up."

/** Re-render every 30 s so "4 min ago" keeps up. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function Component() {
  const status = useCloud().data
  const campaigns = useCampaigns().data
  const campaignName = campaigns?.campaigns.find((c) => c.id === campaigns.campaign)?.name ?? ""

  if (!status) {
    return (
      <div className="p-8">
        <PageHeading eyebrow="Troubadour Cloud" title="Troubadour Cloud" subtitle={SUBTITLE} />
        <Spinner />
      </div>
    )
  }
  if (!status.connected) return <NotConnected campaignName={campaignName} />
  return <Connected campaignName={campaignName} />
}

function NotConnected({ campaignName }: { campaignName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex max-w-[760px] flex-col gap-5 p-8">
      <PageHeading eyebrow="Troubadour Cloud" title="Troubadour Cloud" subtitle={SUBTITLE} />
      <Card className="flex items-center gap-4 px-5 py-4">
        <IconTile size={36}>
          <CloudOff size={20} aria-hidden />
        </IconTile>
        <div className="flex-1">
          <div className="text-16 font-bold">Not connected</div>
          <div className="text-13 text-ink-subtle">
            Notes, codex entries and write-ups go up with a history you can restore from. Nothing leaves this
            Mac until you connect.
          </div>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Connect
        </Button>
      </Card>
      <ConnectDialog open={open} onOpenChange={setOpen} campaignName={campaignName} />
    </div>
  )
}

function Connected({ campaignName }: { campaignName: string }) {
  const status = useCloud().data!
  const options = useCloudOptions()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-8 p-8">
      <section className="flex flex-col gap-4.5">
        <PageHeading eyebrow="Troubadour Cloud" title="Troubadour Cloud" subtitle={SUBTITLE} />
        <StatusCard campaignName={campaignName} />
        <WhatGoesUp />
        <Card className="flex items-center gap-3.5 px-4 py-3">
          <Laptop size={18} className="text-ink-muted" aria-hidden />
          <div className="flex-1">
            <div className="font-semibold">
              Main Mac: {status.main_device}
              {status.is_main ? <span className="font-medium text-ink-subtle"> (this one)</span> : null}
            </div>
            <div className="text-12 text-ink-subtle">
              Only one Mac should run this campaign. If another Mac backs it up too, the newest backup wins.
            </div>
          </div>
        </Card>
        <Card className="flex items-center gap-3.5 px-4 py-3">
          <label htmlFor="cloud-auto" className="flex-1">
            <div className="font-semibold">Back up automatically</div>
            <div className="text-12 text-ink-subtle">
              A couple of minutes after notes change, at most every 10 minutes. Never during a live session.
            </div>
          </label>
          <Switch
            id="cloud-auto"
            checked={status.auto_backup}
            onCheckedChange={(auto_backup) => options.mutate({ auto_backup })}
          />
        </Card>
      </section>
      <Sidebar />
    </div>
  )
}

function StatusCard({ campaignName }: { campaignName: string }) {
  const status = useCloud().data!
  const live = useLive((s) => !!s.session && s.session.status !== "idle")
  const backupJob = useJob("backup")
  const backup = useCloudBackup()
  const now = useNow()
  const ctx: CloudContext = { backingUp: backupJob.active, live }
  const tone = cloudTone(status, ctx)
  const failed = cloudState(status, ctx) === "failed"
  const files = status.last_backup?.files
  const facts = [
    campaignName,
    files !== undefined ? `${files.toLocaleString("en-US")} files` : null,
    failed && status.last_error ? status.last_error.message : "checks again a few minutes after notes change",
  ].filter(Boolean)

  return (
    <Card className="flex items-center gap-4 px-5 py-4">
      <IconTile tone={tone} size={36}>
        <Cloud size={22} aria-hidden />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-18 font-bold">{cloudChipLabel(status, now, ctx)}</div>
        <div className="text-13 text-ink-subtle">{facts.join(" · ")}</div>
      </div>
      <Button variant="primary" disabled={ctx.backingUp || backup.isPending} onClick={() => backup.mutate()}>
        <RefreshCw size={14} aria-hidden />
        Back up now
      </Button>
      <a
        href={status.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-13 whitespace-nowrap"
      >
        Open player view
        <ExternalLink size={13} aria-hidden />
      </a>
    </Card>
  )
}
