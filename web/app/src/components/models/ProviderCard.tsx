import type { ReactNode } from "react"

export type ProviderCardProps = {
  title: string
  subtitle: string
  /** Right-hand state: "Connected" (success), "Sign in" or "Add key" (accent). */
  state?: { text: string; connected: boolean } | null
  selected: boolean
  onSelect: () => void
  children?: ReactNode
}

/** One radio card in the provider list. The selected card's panel (`children`) sits under its row. */
export function ProviderCard({ title, subtitle, state, selected, onSelect, children }: ProviderCardProps) {
  return (
    <div
      className={`rounded-card border bg-surface ${
        selected ? "border-accent-strong ring-1 ring-accent-strong" : "border-line"
      }`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3 text-left"
      >
        <span
          aria-hidden
          className={`size-4 shrink-0 rounded-full border-[1.5px] ${
            selected
              ? "border-accent-strong bg-accent-strong shadow-[inset_0_0_0_3px_var(--color-surface)]"
              : "border-line-strong"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-12 text-ink-subtle">{subtitle}</span>
        </span>
        {state && (
          <span className={`text-12 font-semibold ${state.connected ? "text-success" : "text-accent"}`}>
            {state.text}
          </span>
        )}
      </button>
      {selected && children ? <div className="flex flex-col gap-3 px-4 pb-4">{children}</div> : null}
    </div>
  )
}
