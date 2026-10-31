import { Popover } from "@base-ui/react/popover"
import { SWATCH_HUES, SWATCH_NAMES, SWATCH_PALETTE, SWATCH_SHADES } from "@yipe/tokens/palette"
import { cn } from "../lib/cn"

export type ColorSwatchPickerProps = {
  value: string | null
  onChange: (hex: string | null) => void
  label?: string
  /** Offer "Use class colour", which calls `onChange(null)`. */
  allowClear?: boolean
}

export function ColorSwatchPicker({ value, onChange, label = "Colour", allowClear }: ColorSwatchPickerProps) {
  const current = value ? (SWATCH_NAMES[value.toUpperCase()] ?? value) : "auto"
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${label}: ${current}`}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-control border border-line bg-sunken px-2 text-13 text-ink-muted hover:bg-elevated"
      >
        <span
          className={cn("size-4 rounded-full", !value && "border border-dashed border-line-strong")}
          style={value ? { backgroundColor: value } : undefined}
        />
        {value ? null : <span>auto</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup className="flex flex-col gap-2 rounded-card border border-popover-line bg-popover p-2.5 shadow-lg outline-none">
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${SWATCH_HUES.length}, 18px)` }}
            >
              {SWATCH_SHADES.flatMap((shade) =>
                SWATCH_HUES.map((hue) => {
                  const hex = SWATCH_PALETTE[hue][shade]
                  const selected = value?.toUpperCase() === hex.toUpperCase()
                  return (
                    <button
                      key={hex}
                      type="button"
                      aria-label={SWATCH_NAMES[hex]}
                      aria-pressed={selected}
                      onClick={() => onChange(hex)}
                      className={cn(
                        "size-[18px] cursor-pointer rounded-full border-2 border-transparent outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
                        selected && "border-ink",
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  )
                }),
              )}
            </div>
            {allowClear ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="cursor-pointer text-left text-12 text-ink-muted hover:text-ink"
              >
                Use class colour
              </button>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
