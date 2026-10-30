# @troubadour/ui

Domain-free components on Tailwind v4 and `@base-ui/react`, styled from `@yipe/tokens`.

- Exports `./theme.css`, `./gallery` and `./<name>` (one file per component in `src/components/`).
- `pnpm -C packages/ui test`, `pnpm -C packages/ui typecheck`.
- Must not import `@troubadour/api` and must not call `fetch` (oxlint fails the build).
- Rule of two: a component moves here on its second real use.
