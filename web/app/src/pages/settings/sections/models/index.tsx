import { PageHeading } from "@troubadour/ui/page-heading"
import { ModelsSettings } from "../../../../components/models/ModelsSettings.tsx"
import { StorageBar } from "./StorageBar.tsx"
import { WhatLeavesList } from "./WhatLeavesList.tsx"

export function Component() {
  return (
    <div className="flex flex-col items-start gap-8 p-5 md:p-8 xl:flex-row">
      <div className="w-full min-w-0 flex-1">
        <PageHeading
          tone="accent"
          title="Models & privacy"
          subtitle="Where each part of Troubadour runs. Audio and voices never leave this Mac."
          className="mb-6"
        />
        <ModelsSettings />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-6 xl:w-[360px]">
        <WhatLeavesList />
        <StorageBar />
      </div>
    </div>
  )
}
