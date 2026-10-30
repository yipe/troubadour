import { cva } from "class-variance-authority"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { cloneElement } from "react"
import { cn } from "../lib/cn"

const dotTones = {
  neutral: "bg-ink-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
}

const itemVariants = cva(
  "rounded-control text-14 text-ink flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface/60",
  {
    variants: {
      selected: { true: "bg-surface shadow-[inset_0_0_0_1px_var(--color-accent-emphasis)]", false: "" },
    },
    defaultVariants: { selected: false },
  },
)

export type NavItemProps = Omit<ComponentProps<"button">, "children"> & {
  selected?: boolean
  icon?: ReactNode
  sub?: ReactNode
  count?: ReactNode
  dot?: keyof typeof dotTones
  /** An element (for example a router link) that receives the item's props and children. */
  render?: ReactElement<{ className?: string; children?: ReactNode }>
  children: ReactNode
}

export function NavItem({
  selected,
  icon,
  sub,
  count,
  dot,
  render,
  className,
  children,
  ...props
}: NavItemProps) {
  const content = (
    <>
      {icon != null && <span className="flex shrink-0 text-ink-subtle">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {sub != null && <span className="block truncate text-12 text-ink-subtle">{sub}</span>}
      </span>
      {dot != null && <span className={cn("size-[7px] shrink-0 rounded-full", dotTones[dot])} />}
      {count != null && <span className="shrink-0 font-mono text-12 text-ink-subtle">{count}</span>}
    </>
  )
  const classes = cn(itemVariants({ selected: !!selected }), className)
  const aria = selected ? ({ "aria-current": "true" } as const) : {}
  if (render) {
    return cloneElement(render, { className: classes, ...aria, ...props } as object, content)
  }
  return (
    <button type="button" className={classes} {...aria} {...props}>
      {content}
    </button>
  )
}
