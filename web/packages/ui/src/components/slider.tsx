import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "../lib/cn"

export function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="flex h-4 w-full cursor-pointer items-center">
        <SliderPrimitive.Track className="h-1 w-full rounded-full bg-line">
          <SliderPrimitive.Indicator className="rounded-full bg-accent-strong" />
          <SliderPrimitive.Thumb className="block size-4 rounded-full border border-line-strong bg-ink-on-accent outline-none focus-visible:ring-2 focus-visible:ring-accent-strong" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
