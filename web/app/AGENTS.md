# @troubadour/app

The web app: routes, shell, pages (`src/pages/<page>/`), shared domain components (`src/components`).

- `pnpm dev`, `pnpm build` (to `../dist`), `pnpm test`, `pnpm typecheck`.
- `pnpm shot <route> <png> --port <PORT>` and `pnpm smoke`: headless screenshot and route smoke (W2).
- `*.browser.test.tsx` run in headless Chromium (1440x900, muted); `await shot("name")` from
  `test/shot.ts` saves a PNG under `/tmp/troubadour-shots/` when `SHOT=1`.
- `@/` aliases `src/`. Server data only through `@troubadour/api` hooks; never `fetch` here.
- A page may not import another page; promote shared code to `src/components` on its second user.
