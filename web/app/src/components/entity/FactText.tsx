import { splitWikiLinks } from "../../lib/entities.ts"
import { EntityLink } from "./EntityLink.tsx"

/** A fact's text with `[[Target]]` and `[[Target|label]]` turned into links to the codex. */
export function FactText({ text }: { text: string }) {
  return (
    <>
      {splitWikiLinks(text).map((seg, i) =>
        "target" in seg ? (
          <EntityLink key={i} name={seg.target}>
            {seg.text}
          </EntityLink>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
