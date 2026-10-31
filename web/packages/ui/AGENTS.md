# @troubadour/ui

Domain-free components on Tailwind v4 and `@base-ui/react`, styled from `@yipe/tokens`.

- Exports `./theme.css`, `./gallery`, `./<name>` (one file per component in `src/components/`) and the
  `src/lib/` modules listed in `package.json` (`./cn`, `./theme-choice`, `./use-theme-choice`).
- `pnpm -C packages/ui test`, `pnpm -C packages/ui typecheck`.
- Must not import `@troubadour/api` and must not call `fetch` (oxlint fails the build).
- Rule of two: a component moves here on its second real use.
- The cloud website (`yipe/troubadour-cloud`) copies the components it uses with `pnpm sync:ui`, following
  relative imports. Keep them relative and extensionless (`./dropdown-menu`, `../lib/cn`), and keep
  `src/lib/theme-choice.ts` free of React: the website's server layout imports its boot script.
