import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/cn"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent-strong text-ink-on-accent hover:brightness-110",
        secondary: "border border-line bg-surface text-ink hover:bg-elevated",
        ghost: "border border-line bg-transparent text-ink hover:bg-elevated",
        danger: "bg-danger-soft text-danger hover:brightness-125",
        warning: "bg-warning text-black hover:brightness-110",
        link: "h-auto bg-transparent p-0 text-accent hover:text-ink",
      },
      size: {
        sm: "h-7 px-2.5 text-13",
        md: "h-8 px-3 text-13",
        lg: "h-[38px] px-4 text-14",
        xl: "h-12 px-5 text-16",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
)

export type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <ButtonPrimitive className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
