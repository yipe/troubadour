/**
 * "Troubadour" set the way DPRcalc sets its name: a bold capital at 20px, the rest in small caps at 18px,
 * in the same Georgia serif stack (`font-serif`).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">Troubadour</span>
      <span aria-hidden="true" className="font-serif text-20 font-bold">
        T
      </span>
      <span aria-hidden="true" className="font-serif text-18 font-bold [font-variant:small-caps]">
        roubadour
      </span>
    </span>
  )
}
