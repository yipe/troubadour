import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-14", className)} {...props} />
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("border-b border-line", className)} {...props} />
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn("px-3 py-2 text-left font-serif text-13 font-semibold text-ink-muted", className)}
      {...props}
    />
  )
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("even:bg-sunken/40", className)} {...props} />
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-top", className)} {...props} />
}
