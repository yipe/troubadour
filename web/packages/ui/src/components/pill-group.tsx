import { cn } from "../lib/cn"

export type PillItem = { id: string; label: string; count?: number }

export type PillGroupProps = {
  items: PillItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

export function PillGroup({ items, value, onChange, className }: PillGroupProps) {
  return (
    <div role="group" className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "text-13 rounded-full px-3 py-1",
              active ? "bg-accent-strong text-ink-on-accent font-semibold" : "bg-surface text-ink-muted",
            )}
          >
            {item.label}
            {item.count != null && (
              <>
                {" "}
                <span className="opacity-80">{item.count}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
