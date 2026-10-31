import { PageHeading } from "@troubadour/ui/page-heading"
import { cn } from "@troubadour/ui/cn"
import { useThemeChoice, type ThemeChoice } from "../../../../lib/theme.ts"

const OPTIONS: { id: ThemeChoice; label: string; hint: string }[] = [
  { id: "system", label: "System", hint: "Follows your Mac, light by day and dark by night." },
  { id: "dark", label: "Dark", hint: "The default." },
  { id: "light", label: "Light", hint: "For a bright room." },
  { id: "midnight", label: "Midnight", hint: "Darker still, for a dim table." },
]

/** A tiny page in one theme: an element with `data-theme` re-resolves every token inside it. */
function Preview({ theme }: { theme: "dark" | "light" | "midnight" }) {
  return (
    <div data-theme={theme} className="flex h-full flex-1 flex-col gap-1.5 bg-canvas p-2.5">
      <div className="h-1.5 w-1/2 rounded-full bg-ink" />
      <div className="h-1.5 w-3/4 rounded-full bg-ink-muted" />
      <div className="mt-auto flex items-center gap-1.5 rounded-control border border-line bg-surface p-1.5">
        <div className="size-2.5 rounded-full bg-accent-strong" />
        <div className="h-1.5 w-8 rounded-full bg-accent" />
      </div>
    </div>
  )
}

function Swatch({ id }: { id: ThemeChoice }) {
  return (
    <div className="flex h-24 overflow-hidden rounded-control border border-line" aria-hidden>
      {id === "system" ? (
        <>
          <Preview theme="dark" />
          <Preview theme="light" />
        </>
      ) : (
        <Preview theme={id} />
      )}
    </div>
  )
}

export function Component() {
  const [choice, setChoice] = useThemeChoice()
  return (
    <div className="flex max-w-[960px] flex-col gap-8 p-5 md:p-8">
      <PageHeading
        title="Appearance"
        subtitle="How Troubadour looks on this computer. The choice applies at once and is remembered in this browser."
      />
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ id, label, hint }) => (
          <label
            key={id}
            className={cn(
              "flex cursor-pointer flex-col gap-3 rounded-card border bg-surface p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-strong",
              choice === id ? "border-accent-strong" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name="theme"
              value={id}
              checked={choice === id}
              onChange={() => setChoice(id)}
              className="sr-only"
            />
            <Swatch id={id} />
            <div>
              <div className="text-15 font-bold">{label}</div>
              <div className="text-13 text-ink-muted">{hint}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
