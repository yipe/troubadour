import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export type TabItem = { id: string; label: ReactNode; count?: number; dot?: boolean; href?: string }

export type UnderlineTabsProps = {
  items: TabItem[]
  value: string
  onChange?: (id: string) => void
  /**
   * `nav` is the top bar: DPRcalc's UnderlinedTab (serif 18px, colour never changes, a 2px
   * underline inset one corner radius from each edge that floats under the text, fades in on hover
   * and stays on the active tab). `panel` is the in-page tab strip: smaller, state shown by weight and colour.
   */
  size?: "nav" | "panel"
  /** Replaces the default button or link, for router links. Spread `props` onto the element. */
  renderItem?: (
    item: TabItem,
    props: { className: string; "aria-selected": boolean; role: "tab" },
    content: ReactNode,
  ) => ReactNode
  className?: string
}

export function UnderlineTabs({
  items,
  value,
  onChange,
  size = "panel",
  renderItem,
  className,
}: UnderlineTabsProps) {
  return (
    <div role="tablist" className={cn("flex items-end gap-5", className)}>
      {items.map((item) => {
        const active = item.id === value
        const props = {
          role: "tab" as const,
          "aria-selected": active,
          className:
            size === "nav"
              ? cn(
                  "relative inline-flex items-center gap-1.5 rounded-lg px-2 font-serif text-18 font-medium text-ink",
                  // The underline floats just below the text (not on the bar's edge), like DPRcalc's.
                  "after:absolute after:inset-x-2 after:top-full after:mt-[1.5px] after:h-0.5 after:transition-colors after:duration-500 hover:after:bg-accent",
                  active ? "after:bg-accent" : "after:bg-transparent",
                )
              : cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-14",
                  active
                    ? "text-ink border-accent-strong font-semibold"
                    : "text-ink-subtle border-transparent",
                ),
        }
        const content = (
          <>
            {item.dot && <span className="size-[7px] rounded-full bg-accent" />}
            {item.label}
            {item.count != null && <span className="text-12 font-normal text-ink-subtle">{item.count}</span>}
          </>
        )
        if (renderItem) return <span key={item.id}>{renderItem(item, props, content)}</span>
        if (item.href) {
          return (
            <a key={item.id} href={item.href} {...props}>
              {content}
            </a>
          )
        }
        return (
          <button key={item.id} type="button" onClick={() => onChange?.(item.id)} {...props}>
            {content}
          </button>
        )
      })}
    </div>
  )
}
