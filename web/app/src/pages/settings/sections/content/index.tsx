import { PageHeading } from "@troubadour/ui/page-heading"
import { ClassesSection } from "./ClassesSection.tsx"
import { TermsSection } from "./TermsSection.tsx"

export function Component() {
  return (
    <div className="flex max-w-[960px] flex-col gap-8 p-8">
      <PageHeading
        title="Content"
        subtitle="The classes your players pick from, and the D&D names the spelling cleanup knows."
      />
      <ClassesSection />
      <TermsSection />
    </div>
  )
}
