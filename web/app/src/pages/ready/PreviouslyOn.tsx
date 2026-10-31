import { Link } from "react-router"
import { Megaphone } from "lucide-react"
import type { SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { ReadAloud } from "../../components/read-aloud/ReadAloud.tsx"
import { paths } from "../../paths.ts"
import { readSeconds } from "./readSeconds.ts"

export function PreviouslyOn({ session }: { session: SavedSession | undefined }) {
  const summary = session?.summary?.trim()
  return (
    <section
      aria-label="Previously on"
      className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-card border border-line bg-surface px-5 py-[18px]"
    >
      <div className="flex items-center gap-2">
        <Megaphone className="size-4 text-accent" aria-hidden />
        <h3 className="font-bold">Previously on…</h3>
        {summary && <span className="ml-auto text-12 text-ink-subtle">{readSeconds(summary)} sec read</span>}
      </div>
      {session && summary ? (
        <>
          <p className="font-serif text-16 leading-[1.55] text-ink-muted">{summary}</p>
          <div className="flex-1" />
          <ReadAloud sessionId={session.id} text={summary} />
          <div className="flex gap-2">
            <Button nativeButton={false} render={<Link to={paths.recap(session.id)} />}>
              Edit
            </Button>
          </div>
        </>
      ) : (
        <p className="text-ink-subtle">Nothing yet. Once a session is written up, its recap shows here.</p>
      )}
    </section>
  )
}
