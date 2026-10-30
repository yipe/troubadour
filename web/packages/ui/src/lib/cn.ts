import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Our text sizes are `text-14` etc. Without telling tailwind-merge they are font sizes,
// it treats them as colours and drops one of `text-14 text-ink`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["11", "12", "13", "14", "15", "16", "18", "20", "22", "24", "26", "30", "32", "34"] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
