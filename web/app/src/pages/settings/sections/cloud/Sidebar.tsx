import { useState } from "react"
import { useCampaigns } from "@troubadour/api/campaigns"
import {
  useCloud,
  useCloudAccount,
  useCloudDisconnect,
  useCloudHistory,
  useCloudRestore,
  useCloudVaults,
} from "@troubadour/api/cloud"
import type { BackupAttempt, CloudVault } from "@troubadour/api/cloud"
import { Button } from "@troubadour/ui/button"
import { Card } from "@troubadour/ui/card"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { StatusDot } from "@troubadour/ui/status-dot"
import { dateShort } from "../../../../lib/format.ts"
import { attemptTime, attemptSummary } from "./attempts.ts"

const BRING_BODY =
  "Bringing a campaign here makes this its main computer. Notes that differ are replaced; the old versions move to the vault’s .trash folder."
const RESTORE_BODY =
  "This brings back the notes as they were in that backup. Files it replaces go to .trash in your vault first, so nothing is lost."

export function Sidebar() {
  const status = useCloud().data!
  const vaults = useCloudVaults().data
  const restore = useCloudRestore()
  const [snapshot, setSnapshot] = useState<BackupAttempt | null>(null)
  const [bring, setBring] = useState<CloudVault | null>(null)
  const thisVault = vaults?.find((v) => v.campaign_id === status.campaign)
  const others = vaults?.filter((v) => v.campaign_id !== status.campaign && v.head_snapshot) ?? []
  // A campaign this computer already has is never offered for "Bring to this computer": that would replace newer
  // local notes with the cloud copy. It is restored from its own Cloud settings once opened.
  const local = new Set(useCampaigns().data?.campaigns.map((c) => c.id) ?? [])

  return (
    <aside className="flex min-h-0 flex-col gap-4 pt-1">
      <History onRestore={setSnapshot} />
      <Card className="flex flex-col gap-2.5 px-4 py-3.5">
        <h2 className="font-bold">Other campaigns in your cloud</h2>
        {others.length === 0 ? (
          <p className="text-12 text-ink-subtle">No other campaigns are backed up.</p>
        ) : (
          others.map((v) => (
            <div key={v.id} className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate font-semibold">{v.name}</div>
                <div className="text-12 text-ink-subtle">
                  In your cloud since {dateShort(Date.parse(v.created_at) / 1000)}
                </div>
              </div>
              {local.has(v.campaign_id) ? (
                <span className="text-12 text-ink-subtle">On this computer</span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setBring(v)}>
                  Bring to this computer
                </Button>
              )}
            </div>
          ))
        )}
        <p className="text-12 text-ink-subtle">{BRING_BODY}</p>
      </Card>
      <Account />
      <ConfirmDialog
        open={snapshot !== null}
        onOpenChange={(open) => !open && setSnapshot(null)}
        title="Restore this backup?"
        body={RESTORE_BODY}
        confirmLabel="Restore"
        tone="primary"
        onConfirm={async () => {
          if (!thisVault || !snapshot?.snapshot) {
            throw new Error("This campaign isn’t in Troubadour Cloud yet. Back it up first.")
          }
          await restore.mutateAsync({ vaultId: thisVault.id, snapshot: snapshot.snapshot })
        }}
      />
      <ConfirmDialog
        open={bring !== null}
        onOpenChange={(open) => !open && setBring(null)}
        title={`Bring ${bring?.name ?? "this campaign"} to this computer?`}
        body={BRING_BODY}
        confirmLabel="Bring to this computer"
        tone="primary"
        onConfirm={async () => {
          if (bring) await restore.mutateAsync({ vaultId: bring.id })
        }}
      />
    </aside>
  )
}

function History({ onRestore }: { onRestore: (attempt: BackupAttempt) => void }) {
  const attempts = useCloudHistory().data?.attempts ?? []
  const [now] = useState(() => Date.now())
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center border-b border-line px-4 py-3">
        <h2 className="font-bold">Backup history</h2>
        <span className="ml-auto text-12 text-ink-subtle">Kept for 90 days</span>
      </div>
      {attempts.length === 0 ? (
        <p className="px-4 py-3 text-13 text-ink-subtle">No backups yet.</p>
      ) : (
        <ul>
          {attempts.map((a) => (
            <li
              key={`${a.at}-${a.snapshot ?? "failed"}`}
              className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5 last:border-b-0"
            >
              <StatusDot tone={a.ok ? "success" : "danger"} aria-label={a.ok ? "Succeeded" : "Failed"} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-13 font-semibold">{attemptTime(a.at, now)}</div>
                <div className="truncate text-12 text-ink-subtle">{attemptSummary(a)}</div>
              </div>
              {a.ok && a.snapshot ? (
                <Button variant="link" size="sm" onClick={() => onRestore(a)}>
                  Restore…
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Account() {
  const email = useCloudAccount().data?.email
  const disconnect = useCloudDisconnect()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="mt-auto flex items-center gap-2 text-12 text-ink-subtle">
      <span>{email ? `Signed in as ${email}` : "Signed in"}</span>
      <Button
        variant="link"
        size="sm"
        className="ml-auto text-danger hover:text-danger"
        onClick={() => setConfirm(true)}
      >
        Disconnect
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect from Troubadour Cloud?"
        body="Backups stop and this computer signs out. What is already in your cloud stays there, and your notes here are untouched."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={async () => {
          await disconnect.mutateAsync()
        }}
      />
    </div>
  )
}
