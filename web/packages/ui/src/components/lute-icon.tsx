import type { SVGProps } from "react"

/** A solid lute in the weight of DPRcalc's d20 mark, so the two read as one brand. Takes the text colour. */
export function LuteIcon({ size = 20, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} fill="currentColor" aria-hidden="true" {...props}>
      <g transform="rotate(40 256 256)">
        <path
          fillRule="evenodd"
          d="M256 228c-40 0-70 28-74 66-30 22-48 54-48 88 0 62 52 100 122 100s122-38 122-100c0-34-18-66-48-88-4-38-34-66-74-66zm0 76a38 38 0 1 1 0 76 38 38 0 1 1 0-76zM230 436h52v14h-52z"
        />
        <path d="M238 236V98l-6-3V42c0-8 4-14 11-18l48-22c9-4 18 2 18 11v46c0 6-4 12-10 14l-27 12V236z" />
      </g>
    </svg>
  )
}
