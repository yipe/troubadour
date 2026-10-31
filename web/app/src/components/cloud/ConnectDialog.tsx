import { CloudUpload, ExternalLink, Lock } from "lucide-react"
import { useState } from "react"
import { cloudConnect, useCloudOptions } from "@troubadour/api/cloud"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { Switch } from "@troubadour/ui/switch"
import { openSignIn } from "../../lib/signIn.ts"

const GOES_UP = [
  "Notes, codex entries and facts",
  "Session write-ups and recaps",
  "Backup history for 90 days",
]
const STAYS = ["Audio recordings", "Voiceprints", "The AI model and your questions"]

export interface ConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignName: string
}

/** First connect (2a). Nothing reaches the network until "Connect" is clicked. */
export function ConnectDialog({ open, onOpenChange, campaignName }: ConnectDialogProps) {
  const [transcripts, setTranscripts] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = useCloudOptions()

  async function connect() {
    setError(null)
    try {
      // The tab opens inside openSignIn during this click; the option is saved before the sign-in starts.
      await openSignIn(async () => {
        if (transcripts) await options.mutateAsync({ include_transcripts: true })
        return (await cloudConnect()).authorize_url
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          icon={<CloudUpload />}
          title={`Back up ${campaignName}`}
          description="Keep a copy of this campaign’s notes online, with history, and read them in a browser. Nothing leaves this computer until you connect."
        />
        <div className="grid grid-cols-2 gap-3.5 px-6 py-4">
          <section className="flex flex-col gap-2 rounded-card border border-line bg-sunken p-3.5">
            <h3 className="text-12 font-bold tracking-[0.08em] text-accent uppercase">Goes up</h3>
            {GOES_UP.map((line) => (
              <div key={line} className="flex gap-2 text-13">
                <span aria-hidden className="font-bold text-success">
                  ✓
                </span>
                {line}
              </div>
            ))}
            <label className="mt-1 flex items-center gap-2.5 border-t border-line pt-2 text-13">
              <Switch checked={transcripts} onCheckedChange={setTranscripts} aria-label="Also transcripts" />
              Also transcripts
            </label>
          </section>
          <section className="flex flex-col gap-2 rounded-card border border-line bg-sunken p-3.5">
            <h3 className="text-12 font-bold tracking-[0.08em] text-ink-subtle uppercase">
              Stays on this computer
            </h3>
            {STAYS.map((line) => (
              <div key={line} className="flex items-center gap-2 text-13 text-ink-muted">
                <Lock size={13} aria-hidden />
                {line}
              </div>
            ))}
          </section>
        </div>
        {error ? (
          <p role="alert" className="px-6 pb-3 text-13 text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter note="You’ll sign in in your browser, then come back here.">
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button variant="primary" size="lg" onClick={() => void connect()}>
            Connect
            <ExternalLink size={13} aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
