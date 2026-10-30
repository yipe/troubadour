import { PageHeading } from "@troubadour/ui/page-heading"
import { ModelsSettings } from "../../../../components/models/ModelsSettings.tsx"
import { StorageBar } from "./StorageBar.tsx"
import { WhatLeavesList } from "./WhatLeavesList.tsx"

export function Component() {
  return (
    <div className="flex items-start gap-8 p-8">
      <div className="min-w-0 flex-1">
        <PageHeading
          tone="accent"
          title="Models & privacy"
          subtitle="Where each part of Troubadour runs. Audio and voices never leave this Mac."
          className="mb-6"
        />
        <ModelsSettings />
      </div>
      <div className="flex w-[360px] shrink-0 flex-col gap-6">
        <WhatLeavesList />
        <StorageBar />
      </div>
    </div>
  )
}
