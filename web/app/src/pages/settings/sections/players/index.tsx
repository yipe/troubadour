import { PageHeading } from "@troubadour/ui/page-heading"
import { PlayersTable } from "../../../../components/players/PlayersTable.tsx"
import { ClassesSection } from "./ClassesSection.tsx"
import { ClonesSection } from "./ClonesSection.tsx"
import { LibrarySection } from "./LibrarySection.tsx"

export function Component() {
  return (
    <div className="flex max-w-[960px] flex-col gap-8 p-8">
      <PageHeading
        eyebrow="Players & voices"
        title="Players & voices"
        subtitle="Who sits at the table, their classes, and the voices Troubadour may speak in."
      />
      <PlayersTable mode="settings" />
      <LibrarySection />
      <ClassesSection />
      <ClonesSection />
    </div>
  )
}
