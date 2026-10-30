import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { addClass, type DndClass } from "@troubadour/api/players"
import { keys } from "@troubadour/api/query"
import { Button } from "@troubadour/ui/button"
import { ColorSwatchPicker } from "@troubadour/ui/color-swatch-picker"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { Input } from "@troubadour/ui/input"
import { notify } from "@troubadour/ui/toast"

const DEFAULT_COLOR = "#8b5cf6"

/** A custom class: a name and a colour. `onAdded` gets the class the server created. */
export function AddClassDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (cls: DndClass) => void
}) {
  const [label, setLabel] = useState("")
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const client = useQueryClient()
  // Not `useAddClass`: its result is typed `unknown`, and we need the new class's id.
  const add = useMutation({
    mutationFn: addClass,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.classes() }),
  })
  const name = label.trim()

  const submit = () => {
    if (!name || add.isPending) return
    add.mutate(
      { label: name, color },
      {
        onSuccess: (cls) => {
          setLabel("")
          onOpenChange(false)
          onAdded(cls)
        },
        onError: (e) => notify(e.message, { tone: "danger" }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Add a class" description="For homebrew or anything the list is missing." />
        <DialogBody className="flex items-center gap-3">
          <Input
            aria-label="Class name"
            placeholder="Class name"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <ColorSwatchPicker value={color} onChange={(hex) => hex && setColor(hex)} label="Class colour" />
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name || add.isPending} onClick={submit}>
            Add class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
