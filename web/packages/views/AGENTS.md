# @troubadour/views

Display-only campaign views (timeline rows, the travel line, talk segments) shared by the app and the cloud
website. Built on `@troubadour/ui`; data comes in as props.

- Must not import `@troubadour/api`, react-router or call `fetch`: the cloud website renders these on Next.js.
  Links are render props.
- `pnpm -C packages/views test`, `pnpm -C packages/views typecheck`.
- The cloud website copies them with `pnpm sync:ui`. Keep imports relative and extensionless (`./travel`) or
  `@troubadour/ui/<name>`.
- Rule of two: a view moves here when the cloud website needs it too.
