import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { NativeSelect } from "@troubadour/ui/native-select"
import type { LlmModel } from "@troubadour/api/llm"
import { modelLabel } from "./helpers.ts"

/** A model from what the chosen provider offers, with its price when the provider lists one. Free text when
 * there is no list yet (signed out, server down), so a known id can still be typed. */
export function ModelPicker({
  label,
  value,
  models,
  onChange,
}: {
  label: string
  value: string
  models: LlmModel[]
  onChange: (value: string) => void
}) {
  const selected = models.find((m) => m.id === value)
  return (
    <div className="flex flex-col gap-1">
      <Field label={label}>
        {models.length === 0 ? (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="google/gemma-4-26b-a4b-qat"
            spellCheck={false}
          />
        ) : (
          <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
            {!value && <option value="">Choose a model</option>}
            {value && !selected && <option value={value}>{value} (not offered now)</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {modelLabel(m)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {selected?.price && <p className="text-12 text-ink-subtle">{selected.price}</p>}
    </div>
  )
}
