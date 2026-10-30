import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("text-14 w-full border-collapse", className)} {...props} />
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("border-line border-b", className)} {...props} />
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn("text-13 text-ink-muted px-3 py-2 text-left font-serif font-semibold", className)}
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
