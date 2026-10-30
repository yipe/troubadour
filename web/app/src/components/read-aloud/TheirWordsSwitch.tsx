import { Switch } from "@troubadour/ui/switch"

/** "In their words": the AI rewords the text like them and the clone speaks at their pace. Needs their
 * speech profile; `missing` says where to make one. */
export function TheirWordsSwitch({
  profiled,
  checked,
  onChange,
  missing,
}: {
  profiled: boolean
  checked: boolean
  onChange: (on: boolean) => void
  missing: string
}) {
  return (
    <label
      className="flex items-center gap-2 text-13"
      title={profiled ? "Reworded like them by the AI, at their pace" : missing}
    >
      <Switch checked={checked && profiled} disabled={!profiled} onCheckedChange={onChange} />
      In their words
    </label>
  )
}
