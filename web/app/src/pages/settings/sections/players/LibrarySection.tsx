import { useState } from "react"
import { UserPlus, Trash2 } from "lucide-react"
import { useLive } from "@troubadour/api/live"
import { useDeletePlayer, useSeatPlayer, type LibraryPlayer } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { notify } from "@troubadour/ui/toast"
import { PlayerAvatar } from "../../../../components/people/PlayerAvatar.tsx"

/** Players who aren't seated in the open campaign: benched here or playing in another. Seat them
 * again, or delete them for good. */
export function LibrarySection() {
  const library = useLive((s) => s.library)
  const seat = useSeatPlayer()
  const remove = useDeletePlayer()
  const [removing, setRemoving] = useState<LibraryPlayer | null>(null)

  return (
    <section aria-label="Benched players" className="flex flex-col gap-2">
      <h2 className="font-serif text-20 font-bold">Benched and other campaigns</h2>
      {library.length === 0 ? (
        <p className="text-13 text-ink-muted">
          Nobody on the bench. Players you bench, or who play in your other campaigns, wait here.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-card border border-line">
          {library.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 border-t border-line bg-surface px-4 py-2.5 first:border-t-0"
            >
              <PlayerAvatar player={{ ...p, character: "", is_gm: false }} size={36} />
              <span className="flex-1 text-14 font-semibold">{p.name}</span>
              <span className="text-13 text-ink-muted">{p.trained ? "Trained" : "Learns in play"}</span>
              <Button
                disabled={seat.isPending}
                aria-label={`Seat ${p.name}`}
                onClick={() =>
                  seat.mutate({ id: p.id }, { onError: (e) => notify(e.message, { tone: "danger" }) })
                }
              >
                <UserPlus className="size-3.5" /> Seat
              </Button>
              <Button variant="ghost" aria-label={`Delete ${p.name} for good`} onClick={() => setRemoving(p)}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""} for good?`}
        body="This deletes them from every campaign, with their voice training."
        confirmLabel="Remove for good"
        tone="danger"
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id)
        }}
      />
    </section>
  )
}
