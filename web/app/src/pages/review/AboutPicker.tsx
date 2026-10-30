import { useState } from "react"
import { ChevronDown } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@troubadour/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"

export const CAMPAIGN_FACTS = "Campaign facts"

export type AboutPickerProps = {
  /** The entry's name, or null for the campaign's own facts. */
  value: string | null
  names: string[]
  onChange: (about: string | null) => void
}

/** Which entry a fact is about. */
export function AboutPicker({ value, names, onChange }: AboutPickerProps) {
  const [open, setOpen] = useState(false)
  const pick = (about: string | null) => {
    onChange(about)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="About"
        className="inline-flex h-8 min-w-0 items-center gap-2 rounded-control border border-line bg-sunken px-2.5 text-13 text-ink"
      >
        <span className="truncate">{value ?? CAMPAIGN_FACTS}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-subtle" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <Command>
          <CommandInput placeholder="Find an entry" />
          <CommandList>
            <CommandEmpty>No entry by that name.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={CAMPAIGN_FACTS} onSelect={() => pick(null)}>
                {CAMPAIGN_FACTS}
              </CommandItem>
              {names.map((name) => (
                <CommandItem key={name} value={name} onSelect={() => pick(name)}>
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
