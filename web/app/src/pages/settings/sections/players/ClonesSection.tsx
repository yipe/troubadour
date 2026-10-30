import { useState } from "react"
import { AudioLines } from "lucide-react"
import { useClones } from "@troubadour/api/clones"
import { useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { PlayerAvatar } from "../../../../components/people/PlayerAvatar.tsx"
import { VoiceCloneDialog } from "./VoiceCloneDialog.tsx"

/** One row per seated player; "Voice clone…" opens their consent, profile, build and say box. */
export function ClonesSection() {
  const players = useLive((s) => s.players)
  const clones = useClones().data
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <section aria-label="Voice clones" className="flex flex-col gap-2">
      <h2 className="font-serif text-20 font-bold">Voice clones</h2>
      <p className="text-13 text-ink-muted">
        With a player&apos;s consent, Troubadour can speak in their voice. It all stays on this Mac.
      </p>
      <ul className="overflow-hidden rounded-card border border-line">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 border-t border-line bg-surface px-4 py-2.5 first:border-t-0"
          >
            <PlayerAvatar player={p} size={36} />
            <span className="flex-1 text-14 font-semibold">{p.name}</span>
            <span className="text-13 text-ink-muted">
              {!p.clone_ok ? "No consent yet" : clones?.voices[p.id] ? "Voice built" : "Agreed"}
            </span>
            <Button aria-label={`Voice clone for ${p.name}`} onClick={() => setOpenId(p.id)}>
              <AudioLines className="size-3.5" /> Voice clone…
            </Button>
          </li>
        ))}
      </ul>
      {openId && <VoiceCloneDialog playerId={openId} open onOpenChange={(o) => !o && setOpenId(null)} />}
    </section>
  )
}
