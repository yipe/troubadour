import { useMemo } from "react"
import { useParams } from "react-router"
import { useCampaign } from "@troubadour/api/campaign"
import { useLive } from "@troubadour/api/live"
import { useSessions } from "@troubadour/api/sessions"
import { RailLayout } from "@troubadour/ui/rail-layout"
import { Spinner } from "@troubadour/ui/spinner"
import { nextSessionNumber, sessionNumbers } from "../../lib/sessions.ts"
import { SessionDetail } from "./SessionDetail.tsx"
import { SessionList } from "./SessionList.tsx"

export function Component() {
  const { id } = useParams()
  const sessions = useSessions()
  const campaign = useCampaign().data
  const running = useLive((s) => (s.session?.status ?? "idle") !== "idle")
  const list = sessions.data
  const numbers = useMemo(() => sessionNumbers(list ?? []), [list])

  if (!list) return <Spinner />
  // The API sends newest first; the newest is the default selection.
  const selected = list.find((s) => s.id === id) ?? list[0]

  return (
    <RailLayout
      railWidth={380}
      rail={
        <SessionList
          sessions={list}
          selectedId={selected?.id}
          writtenUp={campaign?.written_up ?? {}}
          nextNumber={nextSessionNumber(list)}
          running={running}
        />
      }
    >
      {selected ? (
        <SessionDetail key={selected.id} session={selected} numbers={numbers} />
      ) : (
        <p className="p-10 text-ink-subtle">No sessions yet. Prepare one to get started.</p>
      )}
    </RailLayout>
  )
}
