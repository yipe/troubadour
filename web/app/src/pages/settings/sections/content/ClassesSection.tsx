import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { classColorVar, type DndClass as BuiltInId } from "@yipe/tokens/classes"
import { useClasses, useDeleteClass, useUpdateClass, type DndClass } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { ColorSwatchPicker } from "@troubadour/ui/color-swatch-picker"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { notify } from "@troubadour/ui/toast"
import { AddClassDialog } from "../../../../components/players/AddClassDialog.tsx"

/** The SRD classes (read-only) and the user's own, for an artificer or a homebrew class. */
export function ClassesSection() {
  const classes = useClasses().data ?? []
  const update = useUpdateClass()
  const remove = useDeleteClass()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<DndClass | null>(null)
  const builtIns = classes.filter((c) => c.builtin)
  const custom = classes.filter((c) => !c.builtin)

  return (
    <section aria-label="Classes" className="flex flex-col gap-3">
      <h2 className="font-serif text-20 font-bold">Classes</h2>
      <ul className="flex flex-wrap gap-2">
        {builtIns.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 py-1 text-13"
          >
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: classColorVar(c.id as BuiltInId) }}
            />
            {c.label}
          </li>
        ))}
      </ul>
      <div className="overflow-hidden rounded-card border border-line">
        {custom.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
            <span className="flex-1 text-14 font-semibold">{c.label}</span>
            <ColorSwatchPicker
              label={`Colour for ${c.label}`}
              value={c.color}
              onChange={(hex) =>
                hex &&
                update.mutate(
                  { id: c.id, color: hex },
                  { onError: (e) => notify(e.message, { tone: "danger" }) },
                )
              }
            />
            <Button variant="ghost" aria-label={`Remove ${c.label}`} onClick={() => setRemoving(c)}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full cursor-pointer items-center gap-2 bg-surface px-4 py-3 text-13 font-semibold text-accent hover:bg-elevated"
        >
          <Plus className="size-3.5" /> Add a class
        </button>
      </div>
      <AddClassDialog open={adding} onOpenChange={setAdding} onAdded={() => {}} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.label ?? ""}?`}
        body="Players with this class keep it and fall back to their own colour."
        confirmLabel="Remove class"
        tone="danger"
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id)
        }}
      />
    </section>
  )
}
