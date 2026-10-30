import type { CSSProperties, ElementType } from "react"

export type SpeakerNameProps = {
  name: string
  /** A CSS colour value. */
  color: string
  /** The character they are voicing: shown after the name as "as <character>". */
  character?: string | null
  as?: ElementType
  className?: string
}

export function SpeakerName({ name, color, character, as: Tag = "span", className }: SpeakerNameProps) {
  return (
    <Tag className={`inline-flex items-baseline gap-1.5 ${className ?? ""}`.trim()}>
      <b style={{ "--player": color } as CSSProperties} className="font-bold text-(--player)">
        {name}
      </b>
      {character ? <span className="text-13 text-ink-subtle">as {character}</span> : null}
    </Tag>
  )
}
