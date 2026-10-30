# 0003. A new app beside the old one, not a gradual migration

Status: accepted

## Context

The redesign changes every screen, the routing and the data flow at once. The old app mixed hand-written fetch code, two stores synced to the URL and the old tabs.

## Decision

The new app was built as a pnpm workspace (`app`, `ui`, `api`, `tokens`) on the `yipe/rebuild` branch while the real app kept running from `main`. The old app was parked in `web/legacy/`, not built, and deleted once every page existed. Pure helpers with tests were ported.

## Consequences

There was never a half-old, half-new UI. Changes made on `main` during the rebuild had to be carried into the new pages by hand.

## Alternatives

Migrating page by page behind one router: rejected, because the old and new design systems and data layers would have lived side by side for the whole project.
