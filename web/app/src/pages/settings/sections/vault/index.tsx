import { ExternalLink } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Card, CardBody } from "@troubadour/ui/card"
import { PageHeading } from "@troubadour/ui/page-heading"
import { ImportNotes } from "../../../../components/import-notes/ImportNotes.tsx"
import { obsidianUrl } from "../../../../lib/entities.ts"
import { IgnoredWords } from "./IgnoredWords.tsx"

export function Component() {
  const campaign = useCampaign().data
  return (
    <div className="flex max-w-3xl flex-col gap-8 p-5 md:p-8">
      <PageHeading
        title="Obsidian vault"
        subtitle="Your campaign is a folder of plain Markdown notes you can open in Obsidian."
      />
      <Card>
        <CardBody className="flex flex-col gap-4">
          {campaign && (
            <div className="flex items-center gap-3">
              <code
                className="min-w-0 flex-1 truncate font-mono text-13 text-ink-muted"
                title={campaign.vault}
              >
                {campaign.vault}
              </code>
              {campaign.obsidian ? (
                <Button render={<a href={obsidianUrl(campaign.obsidian)} role="link" />} nativeButton={false}>
                  <ExternalLink size={14} /> Open in Obsidian
                </Button>
              ) : (
                <span className="text-13 text-ink-subtle">Open this folder as a vault in Obsidian first</span>
              )}
            </div>
          )}
          <p className="text-13 text-ink-muted">
            Troubadour owns the frontmatter keys it manages, a note&apos;s description, <code>## Facts</code>{" "}
            and <code>## Suggested facts</code>. Everything else in a note stays yours, and edits you make in
            Obsidian are kept.
          </p>
        </CardBody>
      </Card>
      <section aria-label="Import notes" className="flex flex-col gap-3">
        <h2 className="font-serif text-20 font-bold">Import notes</h2>
        <ImportNotes />
      </section>
      <IgnoredWords />
    </div>
  )
}
