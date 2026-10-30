import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "../lib/cn"

export function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="flex h-4 w-full cursor-pointer items-center">
        <SliderPrimitive.Track className="bg-line h-1 w-full rounded-full">
          <SliderPrimitive.Indicator className="bg-accent-strong rounded-full" />
          <SliderPrimitive.Thumb className="border-line-strong focus-visible:ring-accent-strong block size-4 rounded-full border bg-white outline-none focus-visible:ring-2" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
